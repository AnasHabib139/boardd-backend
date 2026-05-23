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
const monday              = require("../services/mondayService");
const RateLimiter         = require("../utils/importRateLimiter");

const BACKEND_URL = process.env.BACKEND_URL;

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

// Monday public_url is openly accessible — no auth header needed
const uploadAttachmentToS3 = async (url, title, date, userId) => {
  try {
    const res = await fetch(url);
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
  } catch (_) { return null; }
};

const importSingleBoard = async ({
  token, boardId, boardName,
  channel, tab, userId, companyId,
  rl, jobId, userIdStr, progressRef,
}) => {
  // 1. Fetch groups → build status map
  await rl.throttle();
  const groups    = await monday.getBoardGroups(token, boardId);
  const seenSlugs = new Set();
  const groupIdToStatusKey = {};

  let statusDocs = groups.map((g, i) => {
    const slug = ensureUniqueSlug(slugify(g.title), seenSlugs);
    groupIdToStatusKey[g.id] = slug;
    return { statusKey: slug, statusName: g.title, color: g.color || assignColor(i), order: i + 1, isSystem: false };
  });

  if (statusDocs.length === 0) {
    statusDocs = [{ statusKey: "items", statusName: "Items", color: "#6C63FF", order: 1, isSystem: false }];
  }

  // 2. Create Boardd Project
  const today             = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project           = await createProject({
    name:        boardName,
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

  // 3. Create TabTaskStatuses from groups
  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  // 4. Cursor-based pagination
  let itemsImported = 0;
  let itemsSkipped  = 0;

  await rl.throttle();
  let page = await monday.getItemsPage(token, boardId);

  while (true) {
    for (const item of page.items || []) {
      // Skip archived/deleted items and subitems
      if (item.state !== "active" || item.parent_item?.id) { itemsSkipped++; continue; }

      const statusKey      = groupIdToStatusKey[item.group?.id] || statusDocs[0].statusKey;
      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);

      // Due date
      const dateCol    = (item.column_values || []).find(c => c.type === "date");
      const dueDateStr = monday.parseDateColumn(dateCol);

      // Attachments
      const fileCol     = (item.column_values || []).find(c => c.type === "file");
      const files       = monday.parseFileColumn(fileCol);
      const attachments = [];
      for (const f of files) {
        if (!f.public_url) continue;
        const up = await uploadAttachmentToS3(f.public_url, f.name, f.created_at, userId);
        if (up) attachments.push(up);
      }

      await createTask({
        title:       item.name,
        description: "",
        projectId:   project._id,
        companyId,
        tabId:       tab._id,
        createdBy:   userId,
        assignedTo:  [],
        status:      statusKey,
        priority:    "medium",
        dueDate:     dueDateStr ? new Date(dueDateStr) : undefined,
        tags:        [],
        orderIndex:  new Map([[statusKey, taskOrderIndex]]),
        checklist:   [],
        attachments,
      });
      itemsImported++;

      // Progress — per item, total stays 0
      progressRef.current++;
      emitProgress(userIdStr, jobId, {
        platform: "monday",
        status:   "running",
        progress: { current: progressRef.current, total: 0, currentItem: item.name },
      });
      await updateImportJob({ _id: jobId }, {
        "progress.current":     progressRef.current,
        "progress.currentItem": item.name,
      });
    }

    if (!page.cursor) break;
    await rl.throttle();
    page = await monday.getNextItemsPage(token, page.cursor);
  }

  return { boardId, boardName, projectId: project._id, statusesCreated: statusDocs.length, itemsImported, itemsSkipped };
};

const startMondayImportWorker = () => {
  const worker = new Worker(
    "monday-import",
    async (job) => {
      const { jobId, userId: userIdStr, token, boardIds, boardNameMap, channel, tab, channelId } = job.data;
      const { Types } = require("mongoose");
      const userId    = Types.ObjectId.createFromHexString(userIdStr);
      const companyId = Types.ObjectId.createFromHexString(job.data.companyId);

      // 16/min = ~960/day — safe under Monday free tier's 1,000/day limit
      const rl          = new RateLimiter(16);
      const progressRef = { current: 0, total: 0 };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, {
        platform: "monday",
        status:   "running",
        progress: { current: 0, total: 0, currentItem: "Starting import..." },
      });
      console.log(`[Monday Import] Job ${jobId} started — boards: ${boardIds.join(", ")}`);

      // Build member map across all boards
      const emailSet = {};
      for (const boardId of boardIds) {
        await rl.throttle();
        const subscribers = await monday.getBoardSubscribers(token, boardId);
        for (const s of subscribers) if (s.email) emailSet[s.email.toLowerCase()] = true;
      }
      const allEmails     = Object.keys(emailSet);
      const existingUsers = allEmails.length
        ? await findManyUsers({ email: { $in: allEmails }, companyId }) : [];
      const memberMap = {};
      for (const u of existingUsers) memberMap[u.email.toLowerCase()] = u._id;

      // Import each board
      const results = [];
      for (const boardId of boardIds) {
        const boardName = boardNameMap[boardId] || boardId;
        console.log(`[Monday Import] Processing board: ${boardName} (${boardId})`);

        emitProgress(userIdStr, jobId, {
          platform: "monday",
          status:   "running",
          progress: { current: progressRef.current, total: 0, currentItem: `Importing board: ${boardName}` },
        });

        const result = await importSingleBoard({
          token, boardId, boardName,
          channel, tab, userId, companyId,
          rl, jobId, userIdStr, progressRef,
        });

        console.log(
          `[Monday Import] Board done: ${boardName} — ` +
          `${result.itemsImported} items imported, ${result.itemsSkipped} skipped`
        );
        results.push(result);
      }

      const finalResult = {
        channelId:          channel._id,
        tabId:              tab._id,
        isNewChannel:       !channelId,
        boards:             results,
        totalTasksImported: results.reduce((s, r) => s + r.itemsImported, 0),
        totalTasksSkipped:  results.reduce((s, r) => s + r.itemsSkipped, 0),
      };

      // Completion — use finalResult.totalTasksImported, NEVER progressRef.total
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
        platform: "monday",
        status:   "completed",
        progress: {
          current:     finalResult.totalTasksImported,
          total:       finalResult.totalTasksImported,
          currentItem: "Done",
        },
        result: finalResult,
      });
      console.log(`[Monday Import] Job ${jobId} completed — ${finalResult.totalTasksImported} items imported`);

      return finalResult;
    },
    { connection: getBullRedis(), concurrency: 2 }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { jobId, userId: userIdStr } = job.data;
    console.error(`[Monday Import] Job ${jobId} failed:`, err.message);
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "monday", status: "failed", error: err.message });
  });

  console.log("✅ Monday import worker started");
  return worker;
};

module.exports = { startMondayImportWorker };
