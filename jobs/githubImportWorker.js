"use strict";

const { Worker }          = require("bullmq");
const { getBullRedis }    = require("../utils/redis");
const { getIO }           = require("../utils/socket");
const { updateImportJob } = require("../models/importJobModel");
const { createProject, getNextProjectOrderIndex } = require("../models/projectModel");
const { createManyTabTaskStatuses }          = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex }      = require("../models/taskModel");
const { s3Uploadv3 }      = require("../utils/s3Upload");
const github               = require("../services/githubService");
const RateLimiter         = require("../utils/importRateLimiter");

const BACKEND_URL = process.env.BACKEND_URL;

// ─── Private helpers ──────────────────────────────────────────────────────────

const emitProgress = (userId, jobId, payload) => {
  try {
    const io = getIO();
    if (io) io.to(`user:${userId}`).emit("import:progress", { jobId, ...payload });
  } catch (_) {}
};

// Fixed 2-status board — GitHub Issues have no custom workflow states.
const GITHUB_STATUSES = [
  { statusKey: "open",   statusName: "Open",   color: "#10B981", order: 1, isSystem: false },
  { statusKey: "closed", statusName: "Closed", color: "#6B7280", order: 2, isSystem: false },
];

// Download a GitHub-hosted attachment and upload to S3.
// Legacy user-images.githubusercontent.com URLs are public (no auth header needed).
// Current github.com/user-attachments/assets/{uuid} URLs require Bearer auth and
// the fetch call follows the redirect to the signed S3 URL automatically.
// Returns an attachment object, or null on failure (logged, never throws).
const uploadGithubFileToS3 = async (fileUrl, token, userId, taskTitle) => {
  try {
    const needsAuth = fileUrl.includes("github.com/user-attachments/");
    const headers   = needsAuth ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(fileUrl, { headers });
    if (!res.ok) {
      console.error(`[GitHub Import] Attachment download failed (HTTP ${res.status}) for task "${taskTitle}": ${fileUrl}`);
      return null;
    }
    const buffer   = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") || "application/octet-stream";
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
  } catch (err) {
    console.error(`[GitHub Import] Attachment upload error for task "${taskTitle}" (${fileUrl}): ${err.message}`);
    return null;
  }
};

// ─── Import one GitHub repo as one Boardd Project ─────────────────────────────

const importSingleRepo = async ({
  token, repoId, repoInfo,
  channel, tab, userId, companyId,
  rl, jobId, userIdStr, progressRef,
}) => {
  const [owner, repo] = repoInfo.fullName.split("/");

  // 1. Create Boardd Project — fixed name from repo
  const today             = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project           = await createProject({
    name:        repoInfo.name,
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

  // 2. Create the fixed open/closed TabTaskStatuses
  await createManyTabTaskStatuses(GITHUB_STATUSES.map((s) => ({ ...s, projectId: project._id })));

  // 3. Offset-paginate all issues (PRs already filtered out by getRepoIssues)
  let issuesImported = 0;
  let issuesSkipped  = 0;
  let page           = 1;

  while (true) {
    await rl.throttle();

    const result = await github.getRepoIssues(token, owner, repo, page);

    for (const issue of result.issues) {
      const title = (issue.title || "").trim();
      if (!title) { issuesSkipped++; continue; }

      const statusKey = issue.state === "closed" ? "closed" : "open";
      const tags       = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
      const dueDate    = issue.milestone && issue.milestone.due_on ? new Date(issue.milestone.due_on) : undefined;

      // Attachments — extract embedded image/file URLs from the raw markdown body
      const attachments = [];
      const fileUrls     = github.extractAttachmentUrls(issue.body);
      for (const fileUrl of fileUrls) {
        await rl.throttle();
        const up = await uploadGithubFileToS3(fileUrl, token, userId, title);
        if (up) attachments.push(up);
      }

      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);
      await createTask({
        title,
        description: issue.body || "",
        projectId:   project._id,
        companyId,
        tabId:       tab._id,
        createdBy:   userId,
        assignedTo:  [],
        status:      statusKey,
        priority:    "medium",
        dueDate,
        tags,
        orderIndex:  new Map([[statusKey, taskOrderIndex]]),
        checklist:   [],
        attachments,
      });

      issuesImported++;

      progressRef.current++;
      emitProgress(userIdStr, jobId, {
        platform: "github",
        status:   "running",
        progress: { current: progressRef.current, total: 0, currentItem: title },
      });
      await updateImportJob({ _id: jobId }, {
        "progress.current":     progressRef.current,
        "progress.currentItem": title,
      });
    }

    if (!result.hasMore) break;
    page++;
  }

  return { projectId: project._id, repoName: repoInfo.fullName, statusesCreated: GITHUB_STATUSES.length, issuesImported, issuesSkipped };
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const startGithubImportWorker = () => {
  const worker = new Worker(
    "github-import",
    async (job) => {
      const {
        jobId, userId: userIdStr, token,
        repoIds, repoInfoMap,
        channel, tab, channelId,
      } = job.data;

      const { Types } = require("mongoose");
      const userId    = Types.ObjectId.createFromHexString(userIdStr);
      const companyId = Types.ObjectId.createFromHexString(job.data.companyId);

      const rl          = new RateLimiter(60);
      const progressRef = { current: 0, total: 0 };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, {
        platform: "github",
        status:   "running",
        progress: { current: 0, total: 0, currentItem: "Starting import..." },
      });
      console.log(`[GitHub Import] Job ${jobId} started — repos: ${repoIds.join(", ")}`);

      const results = [];
      for (const repoId of repoIds) {
        const repoInfo = repoInfoMap[repoId];
        if (!repoInfo) {
          console.error(`[GitHub Import] Skipping unknown repoId ${repoId} — not found in repoInfoMap`);
          continue;
        }
        console.log(`[GitHub Import] Processing repo: ${repoInfo.fullName}`);

        emitProgress(userIdStr, jobId, {
          platform: "github",
          status:   "running",
          progress: { current: progressRef.current, total: 0, currentItem: `Importing repo: ${repoInfo.fullName}` },
        });

        const result = await importSingleRepo({
          token, repoId, repoInfo,
          channel, tab, userId, companyId,
          rl, jobId, userIdStr, progressRef,
        });

        console.log(
          `[GitHub Import] Repo done: ${repoInfo.fullName} — ` +
          `${result.issuesImported} issues imported, ${result.issuesSkipped} skipped`
        );
        results.push(result);
      }

      const finalResult = {
        channelId:           channel._id,
        tabId:               tab._id,
        isNewChannel:        !channelId,
        repos:               results,
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
        platform: "github",
        status:   "completed",
        progress: {
          current:     finalResult.totalIssuesImported,
          total:       finalResult.totalIssuesImported,
          currentItem: "Done",
        },
        result: finalResult,
      });
      console.log(`[GitHub Import] Job ${jobId} completed — ${finalResult.totalIssuesImported} issues imported`);

      return finalResult;
    },
    { connection: getBullRedis(), concurrency: 2 }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { jobId, userId: userIdStr } = job.data;
    console.error(`[GitHub Import] Job ${jobId} failed:`, err.message);
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "github", status: "failed", error: err.message });
  });

  console.log("✅ GitHub import worker started");
  return worker;
};

module.exports = { startGithubImportWorker };
