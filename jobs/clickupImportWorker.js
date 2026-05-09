"use strict";

const { Worker } = require("bullmq");
const { getRedis } = require("../utils/redis");
const { getIO } = require("../utils/socket");
const { updateImportJob } = require("../models/importJobModel");
const { createProject, getNextProjectOrderIndex } = require("../models/projectModel");
const { createManyTabTaskStatuses } = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex } = require("../models/taskModel");
const { findManyUsers } = require("../models/userModel");
const { s3Uploadv3 } = require("../utils/s3Upload");
const clickup = require("../services/clickupService");
const RateLimiter = require("../utils/importRateLimiter");

const BACKEND_URL = process.env.BACKEND_URL;

// ─── Private helpers ────────────────────────────────────────────────────────

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const ensureUniqueSlug = (slug, seen) => {
  if (!seen.has(slug)) { seen.add(slug); return slug; }
  let i = 2;
  while (seen.has(`${slug}_${i}`)) i++;
  const unique = `${slug}_${i}`;
  seen.add(unique);
  return unique;
};

const STATUS_COLORS = [
  "#6C63FF", "#F59E0B", "#10B981", "#EF4444",
  "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6",
];
const assignColor = (index) => STATUS_COLORS[index % STATUS_COLORS.length];

const flattenChecklists = (checklists = []) => {
  const items = [];
  let order = 1;
  for (const cl of checklists) {
    for (const item of cl.items || []) {
      items.push({ name: item.name, isCompleted: item.resolved === true, order: order++ });
    }
  }
  return items;
};

const mapPriority = (priority) => {
  if (!priority) return "medium";
  return { urgent: "urgent", high: "high", normal: "medium", low: "low" }[priority.priority] || "medium";
};

const emitProgress = (userId, jobId, payload) => {
  try {
    const io = getIO();
    if (io) io.to(`user:${userId}`).emit("import:progress", { jobId, ...payload });
  } catch (_) {}
};

// Download a file from a URL and upload to S3; returns Boardd attachment object or null
const uploadAttachmentToS3 = async (url, title, date, userId) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "application/octet-stream";
    const [uploaded] = await s3Uploadv3([{
      buffer,
      originalname: title || "attachment",
      mimetype: mimeType,
      size: buffer.length,
    }]);
    return {
      url: `${BACKEND_URL}${uploaded.path}`,
      fileName: title || "attachment",
      fileSize: buffer.length,
      mimeType,
      uploadedBy: userId,
      uploadedAt: date ? new Date(Number(date)) : new Date(),
      source: "local",
    };
  } catch (_) {
    return null; // skip failed attachments, don't fail the task
  }
};

// Import a single ClickUp List as one Boardd Project
const importSingleList = async ({ token, list, channel, tab, userId, companyId, memberMap, rl, jobId, userIdStr, progressRef }) => {
  const sortedStatuses = [...(list.statuses || [])].sort((a, b) => a.orderindex - b.orderindex);
  const seenSlugs = new Set();
  const statusKeyMap = {};
  const statusDocs = sortedStatuses.map((s, index) => {
    const slug = ensureUniqueSlug(slugify(s.status), seenSlugs);
    statusKeyMap[s.status] = slug;
    return { statusKey: slug, statusName: s.status, color: s.color || assignColor(index), order: index + 1, isSystem: false };
  });
  if (statusDocs.length === 0) {
    statusDocs.push({ statusKey: "todo", statusName: "To Do", color: "#6C63FF", order: 1, isSystem: false });
  }

  const today = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project = await createProject({
    name: list.name,
    description: "",
    createdBy: userId,
    companyId,
    channelId: channel._id,
    tabId: tab._id,
    startDate: today,
    endDate: new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()),
    color: "#6C63FF",
    priority: "medium",
    orderIndex: projectOrderIndex,
  });

  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  let tasksImported = 0;
  let tasksSkipped = 0;
  let page = 0;

  while (true) {
    await rl.throttle();
    const tasks = await clickup.getTasksPage(token, list.id, page);
    if (!tasks.length) break;

    for (const task of tasks) {
      if (task.status?.type === "closed" || task.parent) { tasksSkipped++; continue; }

      // Fetch full task detail for attachments
      await rl.throttle();
      const fullTask = await clickup.getTask(token, task.id);

      const statusKey = statusKeyMap[task.status?.status] || statusDocs[0].statusKey;
      const assignedTo = (task.assignees || [])
        .map((a) => memberMap[a.email?.toLowerCase()])
        .filter(Boolean);
      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);

      // Upload attachments to S3
      const attachments = [];
      for (const a of fullTask.attachments || []) {
        const att = await uploadAttachmentToS3(a.url, a.title, a.date, userId);
        if (att) attachments.push(att);
      }

      await createTask({
        title: task.name,
        description: task.description || "",
        projectId: project._id,
        companyId,
        tabId: tab._id,
        createdBy: userId,
        assignedTo,
        status: statusKey,
        priority: mapPriority(task.priority),
        dueDate: task.due_date ? new Date(Number(task.due_date)) : undefined,
        tags: (task.tags || []).map((t) => t.name).filter(Boolean),
        orderIndex: new Map([[statusKey, taskOrderIndex]]),
        checklist: flattenChecklists(task.checklists),
        attachments,
      });
      tasksImported++;

      // Emit per-task progress
      progressRef.current++;
      emitProgress(userIdStr, jobId, {
        platform: "clickup",
        status: "running",
        progress: { current: progressRef.current, total: progressRef.total, currentItem: task.name },
      });
    }

    if (tasks.length < 100) break;
    page++;
  }

  return { listId: list.id, listName: list.name, projectId: project._id, statusesCreated: statusDocs.length, tasksImported, tasksSkipped };
};

// Import a single ClickUp Space
const importSingleSpace = async ({ token, spaceId, spaceName, channel, tab, userId, companyId, rl, jobId, userIdStr, progressRef }) => {
  await rl.throttle();
  const [folders, folderlessLists, spaceMembers] = await Promise.all([
    clickup.getFolders(token, spaceId),
    clickup.getFolderlessLists(token, spaceId),
    clickup.getSpaceMembers(token, spaceId),
  ]);

  const emailToMemberId = {};
  for (const m of spaceMembers) {
    if (m.email) emailToMemberId[m.email.toLowerCase()] = m.id;
  }
  const emails = Object.keys(emailToMemberId);
  const existingUsers = emails.length
    ? await findManyUsers({ email: { $in: emails }, companyId })
    : [];
  const memberMap = {};
  for (const u of existingUsers) memberMap[u.email.toLowerCase()] = u._id;

  const folderLists = [];
  for (const folder of folders) {
    await rl.throttle();
    const lists = await clickup.getFolderLists(token, folder.id);
    folderLists.push(...lists);
  }
  const allLists = [...folderlessLists, ...folderLists];

  const listResults = [];
  for (const list of allLists) {
    emitProgress(userIdStr, jobId, {
      platform: "clickup",
      status: "running",
      progress: { current: progressRef.current, total: progressRef.total, currentItem: `Importing list: ${list.name}` },
    });
    const result = await importSingleList({ token, list, channel, tab, userId, companyId, memberMap, rl, jobId, userIdStr, progressRef });
    listResults.push(result);
  }

  return {
    spaceId,
    spaceName,
    listsImported: listResults.length,
    totalTasksImported: listResults.reduce((s, r) => s + r.tasksImported, 0),
    totalTasksSkipped: listResults.reduce((s, r) => s + r.tasksSkipped, 0),
  };
};

// ─── Worker ─────────────────────────────────────────────────────────────────

const startClickUpImportWorker = () => {
  const worker = new Worker(
    "clickup-import",
    async (job) => {
      const { jobId, userId: userIdStr, token, spaceIds, spaceNameMap, channel, tab, channelId } = job.data;
      const userId = require("mongoose").Types.ObjectId.createFromHexString(userIdStr);
      const companyId = require("mongoose").Types.ObjectId.createFromHexString(job.data.companyId);

      const rl = new RateLimiter(95);
      const progressRef = { current: 0, total: spaceIds.length };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, { platform: "clickup", status: "running", progress: { current: 0, total: spaceIds.length, currentItem: "Starting import..." } });

      const results = [];
      for (const spaceId of spaceIds) {
        const spaceName = spaceNameMap[spaceId] || spaceId;
        const result = await importSingleSpace({ token, spaceId, spaceName, channel, tab, userId, companyId, rl, jobId, userIdStr, progressRef });
        results.push(result);
      }

      const finalResult = {
        channelId: channel._id,
        tabId: tab._id,
        isNewChannel: !channelId,
        spaces: results,
        totalTasksImported: results.reduce((s, r) => s + r.totalTasksImported, 0),
        totalTasksSkipped: results.reduce((s, r) => s + r.totalTasksSkipped, 0),
      };

      await updateImportJob({ _id: jobId }, { status: "completed", result: finalResult, "progress.currentItem": "Done" });
      emitProgress(userIdStr, jobId, { platform: "clickup", status: "completed", progress: { current: progressRef.total, total: progressRef.total, currentItem: "Done" }, result: finalResult });

      return finalResult;
    },
    {
      connection: getRedis(),
      concurrency: 2,
    }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { jobId, userId: userIdStr } = job.data;
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "clickup", status: "failed", error: err.message });
  });

  console.log("✅ ClickUp import worker started");
  return worker;
};

module.exports = { startClickUpImportWorker };
