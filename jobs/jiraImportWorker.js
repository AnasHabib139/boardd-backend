"use strict";

const { Worker }          = require("bullmq");
const { getBullRedis }    = require("../utils/redis");
const { updateImportJob } = require("../models/importJobModel");
const { createProject, getNextProjectOrderIndex }                  = require("../models/projectModel");
const { createManyTabTaskStatuses }                                = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex }                            = require("../models/taskModel");
const { s3Uploadv3 }      = require("../utils/s3Upload");
const jira                = require("../services/jiraService");
const RateLimiter         = require("../utils/importRateLimiter");
const { slugify, ensureUniqueSlug, assignColor, emitProgress, refreshWorkerToken } = require("./helpers/importWorkerShared");

const BACKEND_URL = process.env.BACKEND_URL;

// ─── Private helpers ──────────────────────────────────────────────────────────

// Jira attachment downloads require Bearer auth (unlike Monday public URLs)
const uploadAttachmentToS3 = async (url, token, title, date, userId) => {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

// ─── Import a single Jira project as one Boardd Project ──────────────────────

const importSingleProject = async ({
  tokenState, cloudId, projectId, projectKey, projectName,
  channel, tab, userId, companyId,
  rl, jobId, userIdStr, progressRef,
}) => {
  // 1. Fetch project statuses → build status map keyed by status name slug
  await rl.throttle();
  const statuses   = await jira.getProjectStatuses(tokenState.token, cloudId, projectId);
  const seenSlugs  = new Set();
  const nameToStatusKey = {};

  let statusDocs = statuses.map((s, i) => {
    const slug = ensureUniqueSlug(slugify(s.name), seenSlugs);
    nameToStatusKey[s.name.toLowerCase()] = slug;
    return {
      statusKey:         slug,
      statusName:        s.name,
      color:             assignColor(i),
      order:             i + 1,
      isSystem:          false,
      isCompletedStatus: s.categoryKey === "done",
    };
  });

  if (statusDocs.length === 0) {
    statusDocs = [{ statusKey: "open", statusName: "Open", color: "#6C63FF", order: 1, isSystem: false }];
    nameToStatusKey["open"] = "open";
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

  // 3. Create TabTaskStatuses
  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  // 4. Cursor pagination loop over issues
  let issuesImported = 0;
  let issuesSkipped  = 0;
  let nextPageToken  = null;
  let itemCount      = 0;

  while (true) {
    await rl.throttle();

    // Refresh token every 50 issues to handle imports > 1 hour
    if (itemCount > 0 && itemCount % 50 === 0) {
      await refreshWorkerToken(tokenState, userIdStr, "jira", (rt) => jira.refreshAccessToken(rt));
    }

    const result = await jira.searchIssues(tokenState.token, cloudId, projectKey, nextPageToken);

    for (const issue of result.issues || []) {
      const fields     = issue.fields || {};
      const issueType  = fields.issuetype?.name || "";

      // Skip Epics, Subtasks, and issues with a parent
      if (issueType === "Epic" || issueType === "Subtask" || fields.parent) {
        issuesSkipped++;
        continue;
      }

      const statusName  = (fields.status?.name || "").toLowerCase();
      const statusKey   = nameToStatusKey[statusName] || statusDocs[0].statusKey;
      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);

      // Description — use renderedFields to avoid ADF parsing
      const description = jira.stripHtml(issue.renderedFields?.description);

      // Due date
      const dueDate = fields.duedate ? new Date(fields.duedate) : undefined;

      // Priority
      const priority = jira.mapPriority(fields.priority?.name);

      // Attachments — each requires Bearer auth to download
      const attachments = [];
      for (const att of fields.attachment || []) {
        if (!att.content) continue;
        const up = await uploadAttachmentToS3(
          att.content, tokenState.token, att.filename, att.created, userId
        );
        if (up) attachments.push(up);
      }

      await createTask({
        title:       fields.summary || issue.key,
        description,
        projectId:   project._id,
        companyId,
        tabId:       tab._id,
        createdBy:   userId,
        assignedTo:  [],
        status:      statusKey,
        priority,
        dueDate,
        tags:        [],
        orderIndex:  new Map([[statusKey, taskOrderIndex]]),
        checklist:   [],
        attachments,
      });

      issuesImported++;
      itemCount++;

      // Emit progress per issue
      progressRef.current++;
      emitProgress(userIdStr, jobId, {
        platform: "jira",
        status:   "running",
        progress: { current: progressRef.current, total: 0, currentItem: fields.summary || issue.key },
      });
      await updateImportJob({ _id: jobId }, {
        "progress.current":     progressRef.current,
        "progress.currentItem": fields.summary || issue.key,
      });
    }

    nextPageToken = result.nextPageToken;
    if (!nextPageToken) break;
  }

  return { projectId: project._id, projectName, statusesCreated: statusDocs.length, issuesImported, issuesSkipped };
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const startJiraImportWorker = () => {
  const worker = new Worker(
    "jira-import",
    async (job) => {
      const {
        jobId, userId: userIdStr, cloudId,
        projectIds, projectNameMap, projectKeyMap,
        channel, tab, channelId,
      } = job.data;

      const { Types } = require("mongoose");
      const userId    = Types.ObjectId.createFromHexString(userIdStr);
      const companyId = Types.ObjectId.createFromHexString(job.data.companyId);

      // Mutable token state — refreshed in-place throughout the job
      const tokenState = {
        token:        job.data.token,
        refreshToken: job.data.refreshToken,
        tokenExpiry:  job.data.tokenExpiry,
      };

      const rl          = new RateLimiter(60); // 60/min — Jira allows 100 GET/sec
      const progressRef = { current: 0, total: 0 };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, {
        platform: "jira",
        status:   "running",
        progress: { current: 0, total: 0, currentItem: "Starting import..." },
      });
      console.log(`[Jira Import] Job ${jobId} started — projects: ${projectIds.join(", ")}`);

      // Refresh token upfront if close to expiry
      await refreshWorkerToken(tokenState, userIdStr, "jira", (rt) => jira.refreshAccessToken(rt));

      // Import each project
      const results = [];
      for (const projectId of projectIds) {
        const projectName = projectNameMap[projectId] || projectId;
        const projectKey  = projectKeyMap[projectId]  || projectId;
        console.log(`[Jira Import] Processing project: ${projectName} (${projectKey})`);

        emitProgress(userIdStr, jobId, {
          platform: "jira",
          status:   "running",
          progress: { current: progressRef.current, total: 0, currentItem: `Importing project: ${projectName}` },
        });

        const result = await importSingleProject({
          tokenState, cloudId, projectId, projectKey, projectName,
          channel, tab, userId, companyId,
          rl, jobId, userIdStr, progressRef,
        });

        console.log(
          `[Jira Import] Project done: ${projectName} — ` +
          `${result.issuesImported} issues imported, ${result.issuesSkipped} skipped`
        );
        results.push(result);
      }

      const finalResult = {
        channelId:            channel._id,
        tabId:                tab._id,
        isNewChannel:         !channelId,
        projects:             results,
        totalIssuesImported:  results.reduce((s, r) => s + r.issuesImported, 0),
        totalIssuesSkipped:   results.reduce((s, r) => s + r.issuesSkipped, 0),
      };

      await updateImportJob({ _id: jobId }, {
        status:   "completed",
        result:   finalResult,
        progress: {
          current:     finalResult.totalIssuesImported,
          total:       finalResult.totalIssuesImported,
          currentItem: "Done",
        },
      });
      emitProgress(userIdStr, jobId, {
        platform: "jira",
        status:   "completed",
        progress: {
          current:     finalResult.totalIssuesImported,
          total:       finalResult.totalIssuesImported,
          currentItem: "Done",
        },
        result: finalResult,
      });
      console.log(`[Jira Import] Job ${jobId} completed — ${finalResult.totalIssuesImported} issues imported`);

      return finalResult;
    },
    { connection: getBullRedis(), concurrency: 2 }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { jobId, userId: userIdStr } = job.data;
    console.error(`[Jira Import] Job ${jobId} failed:`, err.message);
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "jira", status: "failed", error: err.message });
  });

  console.log("✅ Jira import worker started");
  return worker;
};

module.exports = { startJiraImportWorker };
