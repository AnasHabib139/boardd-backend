"use strict";

const { Worker }          = require("bullmq");
const { getBullRedis }    = require("../utils/redis");
const { getIO }           = require("../utils/socket");
const { updateImportJob } = require("../models/importJobModel");
const { updateUserIntegration }              = require("../models/userIntegrationModel");
const { createProject, getNextProjectOrderIndex } = require("../models/projectModel");
const { createManyTabTaskStatuses }          = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex }      = require("../models/taskModel");
const { s3Uploadv3 }      = require("../utils/s3Upload");
const { findManyUsers }   = require("../models/userModel");
const linear              = require("../services/linearService");
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

// Map Linear WorkflowState.type → a sensible default color.
// Actual state.color from Linear is used first; this is the fallback.
const STATE_TYPE_COLORS = {
  triage:    "#F59E0B",
  backlog:   "#6B7280",
  unstarted: "#3B82F6",
  started:   "#6C63FF",
  completed: "#10B981",
  canceled:  "#EF4444",
};
const stateColor = (state) =>
  (state.color && state.color !== "#000000") ? state.color : (STATE_TYPE_COLORS[state.type] || "#6C63FF");

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

// Download a file from uploads.linear.app (requires Bearer auth) and upload to S3.
// Returns an attachment object or null on failure.
const uploadLinearFileToS3 = async (fileUrl, token, userId) => {
  try {
    const res = await fetch(fileUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const buffer   = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "application/octet-stream";
    // Derive filename from the last path segment of the URL
    const urlPath  = new URL(fileUrl).pathname;
    const fileName = urlPath.split("/").filter(Boolean).pop() || "attachment";
    const [uploaded] = await s3Uploadv3([{
      buffer,
      originalname: fileName,
      mimetype:     mimeType,
      size:         buffer.length,
    }]);
    return {
      url:        `${BACKEND_URL}${uploaded.path}`,
      fileName,
      fileSize:   buffer.length,
      mimeType,
      uploadedBy: userId,
      uploadedAt: new Date(),
      source:     "local",
    };
  } catch (_) { return null; }
};

// Refresh token in-place if within 5 minutes of expiry.
const refreshWorkerToken = async (tokenState, userIdStr) => {
  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring  = !tokenState.tokenExpiry ||
    new Date(tokenState.tokenExpiry).getTime() - Date.now() < fiveMinutes;

  if (!isExpiring) return tokenState.token;

  const refreshed = await linear.refreshAccessToken(tokenState.refreshToken);
  const expiry    = new Date(Date.now() + refreshed.expires_in * 1000);

  await updateUserIntegration(
    { userId: userIdStr, platform: "linear" },
    { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, tokenExpiry: expiry }
  );

  tokenState.token        = refreshed.access_token;
  tokenState.refreshToken = refreshed.refresh_token;
  tokenState.tokenExpiry  = expiry;

  return refreshed.access_token;
};

// ─── Import one Linear team as one Boardd Project ────────────────────────────

const importSingleTeam = async ({
  tokenState, teamId, teamName,
  channel, tab, userId, companyId,
  rl, jobId, userIdStr, progressRef,
}) => {
  // 1. Fetch workflow states for this team
  await rl.throttle();
  const rawStates  = await linear.getTeamStates(tokenState.token, teamId);
  const seenSlugs  = new Set();
  const nameToStatusKey = {};

  let statusDocs = rawStates.map((s, i) => {
    const slug = ensureUniqueSlug(slugify(s.name), seenSlugs);
    nameToStatusKey[s.name.toLowerCase()] = slug;
    return {
      statusKey:         slug,
      statusName:        s.name,
      color:             stateColor(s),
      order:             i + 1,
      isSystem:          false,
      isCompletedStatus: s.type === "completed",
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
    name:        teamName,
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

  // 4. Cursor-paginate all issues
  let issuesImported = 0;
  let issuesSkipped  = 0;
  let cursor         = null;
  let itemCount      = 0;

  while (true) {
    await rl.throttle();

    // Refresh token every 100 issues to handle long imports
    if (itemCount > 0 && itemCount % 100 === 0) {
      await refreshWorkerToken(tokenState, userIdStr);
    }

    const result = await linear.getTeamIssues(tokenState.token, teamId, cursor);

    for (const issue of result.issues) {
      const title = (issue.title || "").trim();
      if (!title) { issuesSkipped++; continue; }

      const stateName = (issue.state && issue.state.name) ? issue.state.name.toLowerCase() : "";
      const statusKey = nameToStatusKey[stateName] || statusDocs[0].statusKey;
      const priority  = linear.mapPriority(issue.priority);
      const dueDate   = issue.dueDate ? new Date(issue.dueDate) : undefined;

      // Resolve assignee
      const assigneeEmail = issue.assignee && issue.assignee.email ? [issue.assignee.email] : [];
      const assignedTo    = await resolveAssignees(assigneeEmail, companyId);

      // External link attachments → links[] (task.links is a plain array of URL strings)
      const links = [];
      for (const att of (issue.attachments && issue.attachments.nodes) || []) {
        if (!att.url) continue;
        links.push(att.url);
      }

      // Uploaded files in description → attachments[]
      const attachments  = [];
      const fileUrls     = linear.extractLinearFileUrls(issue.description);
      for (const fileUrl of fileUrls) {
        await rl.throttle();
        const up = await uploadLinearFileToS3(fileUrl, tokenState.token, userId);
        if (up) attachments.push(up);
      }

      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);
      await createTask({
        title:       issue.title,
        description: issue.description || "",
        projectId:   project._id,
        companyId,
        tabId:       tab._id,
        createdBy:   userId,
        assignedTo,
        status:      statusKey,
        priority,
        dueDate,
        tags:        [],
        orderIndex:  new Map([[statusKey, taskOrderIndex]]),
        checklist:   [],
        attachments,
        links,
      });

      issuesImported++;
      itemCount++;

      progressRef.current++;
      emitProgress(userIdStr, jobId, {
        platform: "linear",
        status:   "running",
        progress: { current: progressRef.current, total: 0, currentItem: issue.title },
      });
      await updateImportJob({ _id: jobId }, {
        "progress.current":     progressRef.current,
        "progress.currentItem": issue.title,
      });
    }

    cursor = result.hasMore ? result.endCursor : null;
    if (!cursor) break;
  }

  return { projectId: project._id, teamName, statusesCreated: statusDocs.length, issuesImported, issuesSkipped };
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const startLinearImportWorker = () => {
  const worker = new Worker(
    "linear-import",
    async (job) => {
      const {
        jobId, userId: userIdStr,
        teamIds, teamNameMap,
        channel, tab, channelId,
      } = job.data;

      const { Types } = require("mongoose");
      const userId    = Types.ObjectId.createFromHexString(userIdStr);
      const companyId = Types.ObjectId.createFromHexString(job.data.companyId);

      const tokenState = {
        token:        job.data.token,
        refreshToken: job.data.refreshToken,
        tokenExpiry:  job.data.tokenExpiry,
      };

      const rl          = new RateLimiter(30); // 30 GraphQL calls/min — conservative
      const progressRef = { current: 0, total: 0 };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, {
        platform: "linear",
        status:   "running",
        progress: { current: 0, total: 0, currentItem: "Starting import..." },
      });
      console.log(`[Linear Import] Job ${jobId} started — teams: ${teamIds.join(", ")}`);

      await refreshWorkerToken(tokenState, userIdStr);

      const results = [];
      for (const teamId of teamIds) {
        const teamName = teamNameMap[teamId] || teamId;
        console.log(`[Linear Import] Processing team: ${teamName}`);

        emitProgress(userIdStr, jobId, {
          platform: "linear",
          status:   "running",
          progress: { current: progressRef.current, total: 0, currentItem: `Importing team: ${teamName}` },
        });

        const result = await importSingleTeam({
          tokenState, teamId, teamName,
          channel, tab, userId, companyId,
          rl, jobId, userIdStr, progressRef,
        });

        console.log(
          `[Linear Import] Team done: ${teamName} — ` +
          `${result.issuesImported} issues imported, ${result.issuesSkipped} skipped`
        );
        results.push(result);
      }

      const finalResult = {
        channelId:           channel._id,
        tabId:               tab._id,
        isNewChannel:        !channelId,
        teams:               results,
        totalIssuesImported: results.reduce((s, r) => s + r.issuesImported, 0),
        totalIssuesSkipped:  results.reduce((s, r) => s + r.issuesSkipped, 0),
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
        platform: "linear",
        status:   "completed",
        progress: {
          current:     finalResult.totalIssuesImported,
          total:       finalResult.totalIssuesImported,
          currentItem: "Done",
        },
        result: finalResult,
      });
      console.log(`[Linear Import] Job ${jobId} completed — ${finalResult.totalIssuesImported} issues imported`);

      return finalResult;
    },
    { connection: getBullRedis(), concurrency: 2 }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { jobId, userId: userIdStr } = job.data;
    console.error(`[Linear Import] Job ${jobId} failed:`, err.message);
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "linear", status: "failed", error: err.message });
  });

  console.log("✅ Linear import worker started");
  return worker;
};

module.exports = { startLinearImportWorker };
