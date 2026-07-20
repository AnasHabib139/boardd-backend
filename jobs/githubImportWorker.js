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

const slugifyOptionName = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const ensureUniqueSlugForOption = (name, seen) => {
  const base = slugifyOptionName(name) || "status";
  if (!seen.has(base)) { seen.add(base); return base; }
  let i = 2;
  while (seen.has(`${base}_${i}`)) i++;
  const unique = `${base}_${i}`;
  seen.add(unique);
  return unique;
};

// Fixed 2-status board — GitHub Issues have no custom workflow states.
const GITHUB_STATUSES = [
  { statusKey: "open",   statusName: "Open",   color: "#10B981", order: 1, isSystem: false, isCompletedStatus: false },
  { statusKey: "closed", statusName: "Closed", color: "#6B7280", order: 2, isSystem: false, isCompletedStatus: true },
];

// GitHub ProjectV2 single-select option color enum → hex.
const GITHUB_OPTION_COLORS = {
  GRAY:   "#6B7280",
  BLUE:   "#3B82F6",
  GREEN:  "#10B981",
  YELLOW: "#F59E0B",
  ORANGE: "#F97316",
  RED:    "#EF4444",
  PINK:   "#EC4899",
  PURPLE: "#8B5CF6",
};
const optionColorHex = (colorEnum) => GITHUB_OPTION_COLORS[colorEnum] || "#6C63FF";

const NO_STATUS_KEY = "no_status";

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

// ─── Import one GitHub Project v2 board as one Boardd Project ────────────────

const importSingleProject = async ({
  token, projectId, projectInfo,
  channel, tab, userId, companyId,
  rl, jobId, userIdStr, progressRef,
}) => {
  // 1. Fetch the first page to discover fields (Status resolution happens once, up front)
  await rl.throttle();
  const firstPage = await github.getProjectItems(token, projectId, null);

  // Resolve which single-select field is "Status": named "Status" (case-insensitive), else first one.
  let statusField = firstPage.fields.find((f) => (f.name || "").toLowerCase() === "status");
  if (!statusField && firstPage.fields.length > 0) statusField = firstPage.fields[0];

  // Seed with NO_STATUS_KEY before mapping real options so a real option whose
  // name would slugify to "no_status" gets disambiguated (e.g. "no_status_2")
  // instead of colliding with the synthetic "No Status" bucket added below.
  const seenSlugs  = new Set([NO_STATUS_KEY]);
  const nameToStatusKey = {};
  // isCompletedStatus intentionally omitted below (stays schema default false) —
  // GitHub Projects v2's ProjectV2SingleSelectFieldOption has no done/completed
  // field (verified against GitHub's public GraphQL schema). See
  // docs/superpowers/specs/2026-07-19-import-closing-status-decisions.md.
  let statusDocs = [];

  if (statusField) {
    statusDocs = statusField.options.map((opt, i) => {
      const slug = ensureUniqueSlugForOption(opt.name, seenSlugs);
      nameToStatusKey[opt.name.toLowerCase()] = slug;
      return {
        statusKey:  slug,
        statusName: opt.name,
        color:      optionColorHex(opt.color),
        order:      i + 1,
        isSystem:   false,
      };
    });
  }
  // Always add the "No Status" bucket alongside any real options (or as the only status if no field found)
  statusDocs.push({
    statusKey:  NO_STATUS_KEY,
    statusName: "No Status",
    color:      "#6B7280",
    order:      statusDocs.length + 1,
    isSystem:   false,
  });

  // 2. Create Boardd Project
  const today             = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project           = await createProject({
    name:        projectInfo.title,
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

  // 4. Process the first page, then cursor-paginate the rest
  let itemsImported = 0;
  let itemsSkipped  = 0;
  let page  = firstPage;
  let first = true;

  while (true) {
    if (!first) {
      await rl.throttle();
      page = await github.getProjectItems(token, projectId, page.endCursor);
    }
    first = false;

    for (const item of page.items) {
      const content = item.content;
      if (!content || content.__typename === "PullRequest") { itemsSkipped++; continue; }

      const title = (content.title || "").trim();
      if (!title) { itemsSkipped++; continue; }

      // Resolve this item's status field value by matching field.name to the resolved status field's name
      let statusKey = NO_STATUS_KEY;
      if (statusField) {
        const match = item.fieldValues.find(
          (fv) => fv.field && fv.field.name === statusField.name && fv.name
        );
        if (match) statusKey = nameToStatusKey[match.name.toLowerCase()] || NO_STATUS_KEY;
      }

      const isIssue    = content.__typename === "Issue";
      const tags       = isIssue ? (content.labels && content.labels.nodes || []).map((l) => l.name).filter(Boolean) : [];
      const dueDate    = isIssue && content.milestone && content.milestone.dueOn ? new Date(content.milestone.dueOn) : undefined;
      const body       = content.body || "";

      const attachments = [];
      if (isIssue) {
        const fileUrls = github.extractAttachmentUrls(body);
        for (const fileUrl of fileUrls) {
          await rl.throttle();
          const up = await uploadGithubFileToS3(fileUrl, token, userId, title);
          if (up) attachments.push(up);
        }
      }

      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);
      await createTask({
        title,
        description: body,
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

      itemsImported++;

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

    if (!page.hasMore) break;
  }

  return { projectId: project._id, projectTitle: projectInfo.title, statusesCreated: statusDocs.length, itemsImported, itemsSkipped };
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const startGithubImportWorker = () => {
  const worker = new Worker(
    "github-import",
    async (job) => {
      const {
        jobId, userId: userIdStr, token, importType,
        repoIds, repoInfoMap,
        projectIds, projectInfoMap,
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
      const results = [];

      if (importType === "project") {
        console.log(`[GitHub Import] Job ${jobId} started — projects: ${projectIds.join(", ")}`);
        for (const projectId of projectIds) {
          const projectInfo = projectInfoMap[projectId];
          if (!projectInfo) {
            console.error(`[GitHub Import] Skipping unknown projectId ${projectId} — not found in projectInfoMap`);
            continue;
          }
          console.log(`[GitHub Import] Processing project: ${projectInfo.title}`);

          emitProgress(userIdStr, jobId, {
            platform: "github",
            status:   "running",
            progress: { current: progressRef.current, total: 0, currentItem: `Importing project: ${projectInfo.title}` },
          });

          const result = await importSingleProject({
            token, projectId, projectInfo,
            channel, tab, userId, companyId,
            rl, jobId, userIdStr, progressRef,
          });

          console.log(
            `[GitHub Import] Project done: ${projectInfo.title} — ` +
            `${result.itemsImported} items imported, ${result.itemsSkipped} skipped`
          );
          results.push(result);
        }
      } else {
        console.log(`[GitHub Import] Job ${jobId} started — repos: ${repoIds.join(", ")}`);
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
      }

      const finalResult = importType === "project"
        ? {
            channelId:           channel._id,
            tabId:               tab._id,
            isNewChannel:        !channelId,
            projects:            results,
            totalIssuesImported: results.reduce((s, r) => s + r.itemsImported, 0),
            totalIssuesSkipped:  results.reduce((s, r) => s + r.itemsSkipped, 0),
          }
        : {
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
