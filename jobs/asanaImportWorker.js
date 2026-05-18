"use strict";

const { Worker }          = require("bullmq");
const { getBullRedis }    = require("../utils/redis");
const { getIO }           = require("../utils/socket");
const { updateImportJob } = require("../models/importJobModel");
const { createProject, getNextProjectOrderIndex } = require("../models/projectModel");
const { createManyTabTaskStatuses }               = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex }           = require("../models/taskModel");
const { findManyUsers }   = require("../models/userModel");
const { s3Uploadv3 }      = require("../utils/s3Upload");
const asana               = require("../services/asanaService");
const RateLimiter         = require("../utils/importRateLimiter");

const BACKEND_URL = process.env.BACKEND_URL;

// ─── Private helpers ──────────────────────────────────────────────────────────

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

const emitProgress = (userId, jobId, payload) => {
  try {
    const io = getIO();
    if (io) io.to(`user:${userId}`).emit("import:progress", { jobId, ...payload });
  } catch (_) {}
};

// Download from URL and upload to S3. skipAuth=true for Asana pre-signed URLs
// (sending an Authorization header corrupts the pre-signed request signature).
const uploadAttachmentToS3 = async (url, title, date, userId, skipAuth = false) => {
  try {
    const res = await fetch(url, { headers: skipAuth ? {} : {} });
    if (!res.ok) return null;
    const buffer   = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "application/octet-stream";
    const [uploaded] = await s3Uploadv3([{
      buffer,
      originalname: title || "attachment",
      mimetype:     mimeType,
      size:         buffer.length,
    }]);
    return {
      url:        `${BACKEND_URL}${uploaded.path}`,
      fileName:   title || "attachment",
      fileSize:   buffer.length,
      mimeType,
      uploadedBy: userId,
      uploadedAt: date ? new Date(date) : new Date(),
      source:     "local",
    };
  } catch (_) {
    return null;
  }
};

// ─── Import a single Asana project as one Boardd Project ─────────────────────

const importSingleProject = async ({
  token, projectGid, projectName,
  channel, tab, userId, companyId,
  memberMap, rl, jobId, userIdStr, progressRef,
}) => {
  // 1. Fetch sections → build status map keyed by section GID
  await rl.throttle();
  const sections  = await asana.getSections(token, projectGid);
  const seenSlugs = new Set();
  const sectionGidToStatusKey = {};

  let statusDocs = sections.map((s, i) => {
    const slug = ensureUniqueSlug(slugify(s.name), seenSlugs);
    sectionGidToStatusKey[s.gid] = slug;
    return { statusKey: slug, statusName: s.name, color: assignColor(i), order: i + 1, isSystem: false };
  });

  if (statusDocs.length === 0) {
    statusDocs = [{ statusKey: "tasks", statusName: "Tasks", color: "#6C63FF", order: 1, isSystem: false }];
  }

  // 2. Create Boardd Project
  const today             = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project           = await createProject({
    name:        projectName,
    description: "",
    createdBy:   userId,
    companyId,
    channelId:   channel._id,
    tabId:       tab._id,
    startDate:   today,
    endDate:     new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()),
    color:       "#6C63FF",
    priority:    "medium",
    orderIndex:  projectOrderIndex,
  });

  // 3. Create TabTaskStatuses from sections
  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  // 4. Cursor-based task pagination
  let tasksImported = 0;
  let tasksSkipped  = 0;
  let offset        = undefined;

  while (true) {
    await rl.throttle();
    const result = await asana.getTasksPage(token, projectGid, offset);
    const tasks  = result.data || [];

    for (const task of tasks) {
      // Skip completed tasks and subtasks
      if (task.completed || task.parent?.gid) { tasksSkipped++; continue; }

      // Find the section for THIS project (task.memberships spans all its projects)
      const membership = (task.memberships || []).find((m) => m.project?.gid === projectGid);
      const statusKey  = sectionGidToStatusKey[membership?.section?.gid] || statusDocs[0].statusKey;

      const assignedTo     = task.assignee?.email
        ? [memberMap[task.assignee.email.toLowerCase()]].filter(Boolean)
        : [];
      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);

      // Fetch attachments — pre-signed URLs, no auth header needed
      await rl.throttle();
      const rawAtts   = await asana.getAttachments(token, task.gid);
      const attachments = [];
      for (const att of rawAtts) {
        if (!att.download_url) continue;
        const uploaded = await uploadAttachmentToS3(att.download_url, att.name, att.created_at, userId, true);
        if (uploaded) attachments.push(uploaded);
      }

      await createTask({
        title:       task.name,
        description: task.notes || "",
        projectId:   project._id,
        companyId,
        tabId:       tab._id,
        createdBy:   userId,
        assignedTo,
        status:      statusKey,
        priority:    "medium",
        dueDate:     task.due_on ? new Date(task.due_on) : undefined,
        tags:        (task.tags || []).map((t) => t.name).filter(Boolean),
        orderIndex:  new Map([[statusKey, taskOrderIndex]]),
        checklist:   [],
        attachments,
      });
      tasksImported++;

      // Progress — emit socket + write DB per task (total stays 0 until completion)
      progressRef.current++;
      emitProgress(userIdStr, jobId, {
        platform: "asana",
        status:   "running",
        progress: { current: progressRef.current, total: 0, currentItem: task.name },
      });
      await updateImportJob({ _id: jobId }, {
        "progress.current":     progressRef.current,
        "progress.currentItem": task.name,
      });
    }

    if (!result.next_page) break;
    offset = result.next_page.offset;
  }

  return { projectGid, projectName, projectId: project._id, statusesCreated: statusDocs.length, tasksImported, tasksSkipped };
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const startAsanaImportWorker = () => {
  const worker = new Worker(
    "asana-import",
    async (job) => {
      const { jobId, userId: userIdStr, token, projectIds, projectNameMap, channel, tab, channelId } = job.data;
      const userId    = require("mongoose").Types.ObjectId.createFromHexString(userIdStr);
      const companyId = require("mongoose").Types.ObjectId.createFromHexString(job.data.companyId);

      // 140/min — Asana free tier limit is 150; 140 is safe buffer
      const rl          = new RateLimiter(140);
      const progressRef = { current: 0, total: 0 };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, {
        platform: "asana",
        status:   "running",
        progress: { current: 0, total: 0, currentItem: "Starting import..." },
      });
      console.log(`[Asana Import] Job ${jobId} started — projects: ${projectIds.join(", ")}`);

      // Build member map across all selected projects before the loop (one bulk DB query)
      const emailSet = {};
      for (const projectGid of projectIds) {
        await rl.throttle();
        const members = await asana.getProjectMembers(token, projectGid);
        for (const m of members) if (m.email) emailSet[m.email.toLowerCase()] = true;
      }
      const allEmails     = Object.keys(emailSet);
      const existingUsers = allEmails.length
        ? await findManyUsers({ email: { $in: allEmails }, companyId })
        : [];
      const memberMap = {};
      for (const u of existingUsers) memberMap[u.email.toLowerCase()] = u._id;

      // Import each project sequentially
      const results = [];
      for (const projectGid of projectIds) {
        const projectName = projectNameMap[projectGid] || projectGid;
        console.log(`[Asana Import] Processing project: ${projectName} (${projectGid})`);

        emitProgress(userIdStr, jobId, {
          platform: "asana",
          status:   "running",
          progress: { current: progressRef.current, total: 0, currentItem: `Importing project: ${projectName}` },
        });

        const result = await importSingleProject({
          token, projectGid, projectName,
          channel, tab, userId, companyId,
          memberMap, rl, jobId, userIdStr, progressRef,
        });

        console.log(
          `[Asana Import] Project done: ${projectName} — ` +
          `${result.tasksImported} tasks imported, ${result.tasksSkipped} skipped`
        );
        results.push(result);
      }

      const finalResult = {
        channelId:          channel._id,
        tabId:              tab._id,
        isNewChannel:       !channelId,
        projects:           results,
        totalTasksImported: results.reduce((s, r) => s + r.tasksImported, 0),
        totalTasksSkipped:  results.reduce((s, r) => s + r.tasksSkipped, 0),
      };

      // Completion: DB and socket both use finalResult.totalTasksImported (never progressRef.total)
      await updateImportJob({ _id: jobId }, {
        status:   "completed",
        result:   finalResult,
        progress: {
          current:     finalResult.totalTasksImported,
          total:       finalResult.totalTasksImported,
          currentItem: "Done",
        },
      });
      emitProgress(userIdStr, jobId, {
        platform: "asana",
        status:   "completed",
        progress: {
          current:     finalResult.totalTasksImported,
          total:       finalResult.totalTasksImported,
          currentItem: "Done",
        },
        result: finalResult,
      });
      console.log(`[Asana Import] Job ${jobId} completed — total: ${finalResult.totalTasksImported} tasks imported`);

      return finalResult;
    },
    {
      connection: getBullRedis(),
      concurrency: 2,
    }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { jobId, userId: userIdStr } = job.data;
    console.error(`[Asana Import] Job ${jobId} failed:`, err.message);
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "asana", status: "failed", error: err.message });
  });

  console.log("✅ Asana import worker started");
  return worker;
};

module.exports = { startAsanaImportWorker };
