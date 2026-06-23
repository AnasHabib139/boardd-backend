"use strict";

const { Worker }          = require("bullmq");
const { getBullRedis }    = require("../utils/redis");
const { getIO }           = require("../utils/socket");
const { updateImportJob } = require("../models/importJobModel");
const { updateUserIntegration }                                    = require("../models/userIntegrationModel");
const { createProject, getNextProjectOrderIndex }                  = require("../models/projectModel");
const { createManyTabTaskStatuses }                                = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex }                            = require("../models/taskModel");
const { s3Uploadv3 }      = require("../utils/s3Upload");
const { findManyUsers }   = require("../models/userModel");
const notion              = require("../services/notionService");
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

// Resolve an array of email strings to Boardd user _id arrays.
const resolveAssignees = async (emails, companyId) => {
  if (!emails || emails.length === 0) return [];
  const users = await findManyUsers({ email: { $in: emails }, companyId });
  return users.map((u) => u._id);
};

// Download a Notion file attachment and upload to S3.
// file: { name, type: "external"|"file", url }
// External files are public (no auth). "file" type requires Bearer token (pre-signed, ~1hr).
const uploadAttachmentToS3 = async (file, token, userId) => {
  try {
    const headers = {};
    if (file.type === "file") {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(file.url, { headers });
    if (!res.ok) return null;
    const buffer   = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "application/octet-stream";
    const [uploaded] = await s3Uploadv3([{
      buffer,
      originalname: file.name || "attachment",
      mimetype:     mimeType,
      size:         buffer.length,
    }]);
    return {
      url:        `${BACKEND_URL}${uploaded.path}`,
      fileName:   file.name || "attachment",
      fileSize:   buffer.length,
      mimeType,
      uploadedBy: userId,
      uploadedAt: new Date(),
      source:     "local",
    };
  } catch (_) { return null; }
};

// Convert a markdown string to a .md file and upload to S3.
// Returns Boardd attachment shape, or null on failure.
const uploadMarkdownToS3 = async (markdown, slugTitle, userId) => {
  try {
    const buffer = Buffer.from(markdown || "", "utf8");
    const [uploaded] = await s3Uploadv3([{
      buffer,
      originalname: `${slugTitle}.md`,
      mimetype:     "text/markdown",
      size:         buffer.length,
    }]);
    return {
      url:        `${BACKEND_URL}${uploaded.path}`,
      fileName:   `${slugTitle}.md`,
      fileSize:   buffer.length,
      mimeType:   "text/markdown",
      uploadedBy: userId,
      uploadedAt: new Date(),
      source:     "local",
    };
  } catch (_) { return null; }
};

// Refresh access token if it is within 5 minutes of expiry.
// Mutates tokenState in place. Returns the (possibly new) access token.
const refreshWorkerToken = async (tokenState, userIdStr) => {
  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring  = !tokenState.tokenExpiry ||
    new Date(tokenState.tokenExpiry).getTime() - Date.now() < fiveMinutes;

  if (!isExpiring) return tokenState.token;

  const refreshed    = await notion.refreshAccessToken(tokenState.refreshToken);
  const expiresInMs  = (refreshed.expires_in ?? 60 * 24 * 60 * 60) * 1000;
  const expiry       = new Date(Date.now() + expiresInMs);

  await updateUserIntegration(
    { userId: userIdStr, platform: "notion" },
    { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, tokenExpiry: expiry }
  );

  // Mutate tokenState so the worker loop uses the new values
  tokenState.token        = refreshed.access_token;
  tokenState.refreshToken = refreshed.refresh_token;
  tokenState.tokenExpiry  = expiry;

  return refreshed.access_token;
};

// ─── Import a single Notion database as one Boardd Project ───────────────────

const importSingleDatabase = async ({
  tokenState, databaseId, databaseName,
  channel, tab, userId, companyId,
  rl, jobId, userIdStr, progressRef,
}) => {
  // 1. Fetch database schema and extract status options
  await rl.throttle();
  const database   = await notion.getDatabase(tokenState.token, databaseId);
  const seenSlugs  = new Set();
  const nameToStatusKey = {};

  const rawOptions = notion.getDatabaseStatusOptions(database);
  let statusDocs = rawOptions.map((s, i) => {
    const slug = ensureUniqueSlug(slugify(s.name), seenSlugs);
    nameToStatusKey[s.name.toLowerCase()] = slug;
    return { statusKey: slug, statusName: s.name, color: assignColor(i), order: i + 1, isSystem: false };
  });

  if (statusDocs.length === 0) {
    statusDocs = [{ statusKey: "open", statusName: "Open", color: "#6C63FF", order: 1, isSystem: false }];
    nameToStatusKey["open"] = "open";
  }

  // 2. Create Boardd Project
  const today             = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project           = await createProject({
    name:        databaseName,
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

  // 3. Create TabTaskStatuses
  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  // 4. Cursor pagination loop over database rows
  let tasksImported = 0;
  let tasksSkipped  = 0;
  let cursor        = null;
  let itemCount     = 0;

  while (true) {
    await rl.throttle();

    // Refresh token every 50 rows to handle long imports
    if (itemCount > 0 && itemCount % 50 === 0) {
      await refreshWorkerToken(tokenState, userIdStr);
    }

    const result = await notion.queryDatabase(tokenState.token, databaseId, cursor);

    for (const row of result.rows || []) {
      // Skip archived rows
      if (row.archived === true) {
        tasksSkipped++;
        continue;
      }

      const title = notion.getTitleValue(row.properties);
      if (!title) {
        tasksSkipped++;
        continue;
      }

      const statusName    = notion.getStatusName(row.properties);
      const statusKey     = nameToStatusKey[(statusName || "").toLowerCase()] || statusDocs[0].statusKey;
      const dueDate       = notion.getDueDate(row.properties);
      const priority      = notion.mapPriority(notion.getPriorityName(row.properties));
      const emails        = notion.getPeopleEmails(row.properties);
      const files         = notion.getFiles(row.properties);

      // Resolve assignees by email
      const assignedTo = await resolveAssignees(emails, companyId);

      // Fetch page content as markdown for description
      let description = "";
      try {
        await rl.throttle();
        const md = await notion.getPageMarkdown(tokenState.token, row.id);
        description = notion.stripMarkdown(md);
      } catch (_) {}

      // Download and upload attachments to S3
      const attachments = [];
      for (const file of files) {
        if (!file.url) continue;
        const up = await uploadAttachmentToS3(file, tokenState.token, userId);
        if (up) attachments.push(up);
      }

      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);

      await createTask({
        title,
        description,
        projectId:  project._id,
        companyId,
        tabId:      tab._id,
        createdBy:  userId,
        assignedTo,
        status:     statusKey,
        priority,
        dueDate:    dueDate ? new Date(dueDate) : undefined,
        tags:       [],
        orderIndex: new Map([[statusKey, taskOrderIndex]]),
        checklist:  [],
        attachments,
      });

      tasksImported++;
      itemCount++;

      // Emit progress per task
      progressRef.current++;
      emitProgress(userIdStr, jobId, {
        platform: "notion",
        status:   "running",
        progress: { current: progressRef.current, total: 0, currentItem: title },
      });
      await updateImportJob({ _id: jobId }, {
        "progress.current":     progressRef.current,
        "progress.currentItem": title,
      });
    }

    cursor = result.hasMore ? result.nextCursor : null;
    if (!cursor) break;
  }

  return { projectId: project._id, projectName: databaseName, statusesCreated: statusDocs.length, tasksImported, tasksSkipped };
};

// ─── Import standalone pages as one "Notion Pages" Project ───────────────────

const importStandalonePages = async ({
  tokenState, pageIds, pageNameMap, notionPagesProjectName,
  channel, tab, userId, companyId,
  rl, jobId, userIdStr, progressRef,
}) => {
  if (!pageIds || pageIds.length === 0) {
    return { tasksImported: 0, tasksSkipped: 0 };
  }

  // Single default status for all pages
  const statusDocs = [{ statusKey: "open", statusName: "Open", color: "#6C63FF", order: 1, isSystem: false }];

  // Create one Boardd Project for all standalone pages
  const today             = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project           = await createProject({
    name:        notionPagesProjectName || "Notion Pages",
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

  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  let tasksImported = 0;
  let tasksSkipped  = 0;
  let itemCount     = 0;

  for (const pageId of pageIds) {
    await rl.throttle();

    // Refresh token every 50 pages
    if (itemCount > 0 && itemCount % 50 === 0) {
      await refreshWorkerToken(tokenState, userIdStr);
    }

    const title = pageNameMap[pageId] || "Untitled";

    // Fetch page markdown content
    let md = "";
    try {
      await rl.throttle();
      md = await notion.getPageMarkdown(tokenState.token, pageId);
    } catch (_) {}

    // Upload markdown file as attachment
    let attachments = [];
    try {
      const attachment = await uploadMarkdownToS3(md, slugify(title), userId);
      if (attachment) attachments = [attachment];
    } catch (_) {}

    const taskOrderIndex = await getNextOrderIndex(project._id, null, "open");

    await createTask({
      title,
      description: "",
      projectId:   project._id,
      companyId,
      tabId:       tab._id,
      createdBy:   userId,
      assignedTo:  [],
      status:      "open",
      priority:    "medium",
      tags:        [],
      orderIndex:  new Map([["open", taskOrderIndex]]),
      checklist:   [],
      attachments,
    });

    tasksImported++;
    itemCount++;

    // Emit progress per page
    progressRef.current++;
    emitProgress(userIdStr, jobId, {
      platform: "notion",
      status:   "running",
      progress: { current: progressRef.current, total: 0, currentItem: title },
    });
    await updateImportJob({ _id: jobId }, {
      "progress.current":     progressRef.current,
      "progress.currentItem": title,
    });
  }

  return { projectId: project._id, projectName: notionPagesProjectName || "Notion Pages", tasksImported, tasksSkipped };
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const startNotionImportWorker = () => {
  const worker = new Worker(
    "notion-import",
    async (job) => {
      const {
        jobId, userId: userIdStr,
        databaseIds, pageIds, databaseNameMap, pageNameMap,
        notionPagesProjectName, channel, tab, channelId,
      } = job.data;

      const { Types } = require("mongoose");
      const userId    = Types.ObjectId.createFromHexString(userIdStr);
      const companyId = Types.ObjectId.createFromHexString(job.data.companyId);

      // Re-hydrate channel/tab _id as ObjectId (they were serialised as strings in the job payload)
      const channelObj = { ...channel, _id: Types.ObjectId.createFromHexString(channel._id) };
      const tabObj     = { ...tab,     _id: Types.ObjectId.createFromHexString(tab._id) };

      // Mutable token state — refreshed in-place throughout the job
      const tokenState = {
        token:        job.data.token,
        refreshToken: job.data.refreshToken,
        tokenExpiry:  job.data.tokenExpiry,
      };

      const rl          = new RateLimiter(30); // conservative — Notion allows ~3 req/sec
      const progressRef = { current: 0, total: 0 };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, {
        platform: "notion",
        status:   "running",
        progress: { current: 0, total: 0, currentItem: "Starting import..." },
      });
      console.log(`[Notion Import] Job ${jobId} started — databases: ${(databaseIds || []).join(", ")}, pages: ${(pageIds || []).length}`);

      // Refresh token upfront if close to expiry
      await refreshWorkerToken(tokenState, userIdStr);

      const results = [];

      // Import each database as a separate Boardd Project
      for (const databaseId of databaseIds || []) {
        const databaseName = databaseNameMap[databaseId] || databaseId;
        console.log(`[Notion Import] Processing database: ${databaseName} (${databaseId})`);

        emitProgress(userIdStr, jobId, {
          platform: "notion",
          status:   "running",
          progress: { current: progressRef.current, total: 0, currentItem: `Importing database: ${databaseName}` },
        });

        const result = await importSingleDatabase({
          tokenState, databaseId, databaseName,
          channel: channelObj, tab: tabObj, userId, companyId,
          rl, jobId, userIdStr, progressRef,
        });

        console.log(
          `[Notion Import] Database done: ${databaseName} — ` +
          `${result.tasksImported} tasks imported, ${result.tasksSkipped} skipped`
        );
        results.push(result);
      }

      // Import standalone pages as one "Notion Pages" project
      if (pageIds && pageIds.length > 0) {
        console.log(`[Notion Import] Processing ${pageIds.length} standalone pages`);

        emitProgress(userIdStr, jobId, {
          platform: "notion",
          status:   "running",
          progress: { current: progressRef.current, total: 0, currentItem: "Importing standalone pages..." },
        });

        const pagesResult = await importStandalonePages({
          tokenState, pageIds, pageNameMap, notionPagesProjectName,
          channel: channelObj, tab: tabObj, userId, companyId,
          rl, jobId, userIdStr, progressRef,
        });

        console.log(
          `[Notion Import] Pages done — ${pagesResult.tasksImported} tasks imported`
        );
        results.push(pagesResult);
      }

      const totalTasksImported = results.reduce((s, r) => s + (r.tasksImported || 0), 0);
      const totalTasksSkipped  = results.reduce((s, r) => s + (r.tasksSkipped  || 0), 0);

      const finalResult = {
        channelId:         channelObj._id,
        tabId:             tabObj._id,
        isNewChannel:      !channelId,
        projects:          results,
        totalTasksImported,
        totalTasksSkipped,
      };

      await updateImportJob({ _id: jobId }, {
        status:   "completed",
        result:   finalResult,
        progress: {
          current:     totalTasksImported,
          total:       totalTasksImported,
          currentItem: "Done",
        },
      });
      emitProgress(userIdStr, jobId, {
        platform: "notion",
        status:   "completed",
        progress: {
          current:     totalTasksImported,
          total:       totalTasksImported,
          currentItem: "Done",
        },
        result: finalResult,
      });
      console.log(`[Notion Import] Job ${jobId} completed — ${totalTasksImported} tasks imported`);

      return finalResult;
    },
    { connection: getBullRedis(), concurrency: 2 }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { jobId, userId: userIdStr } = job.data;
    console.error(`[Notion Import] Job ${jobId} failed:`, err.message);
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "notion", status: "failed", error: err.message });
  });

  console.log("✅ Notion import worker started");
  return worker;
};

module.exports = { startNotionImportWorker };
