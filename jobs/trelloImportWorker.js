"use strict";

const { Worker }          = require("bullmq");
const { getBullRedis }    = require("../utils/redis");
const { updateImportJob } = require("../models/importJobModel");
const { createProject, getNextProjectOrderIndex } = require("../models/projectModel");
const { createManyTabTaskStatuses }               = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex }           = require("../models/taskModel");
const { findManyUsers }   = require("../models/userModel");
const trello              = require("../services/trelloService");
const { slugify, ensureUniqueSlug, assignColor, emitProgress } = require("./helpers/importWorkerShared");

// ─── Private helpers ────────────────────────────────────────────────────────

const flattenChecklists = (checklists = []) => {
  const items = [];
  let order = 1;
  for (const cl of checklists) {
    for (const item of cl.checkItems || []) {
      items.push({ name: item.name, isCompleted: item.state === "complete", order: order++ });
    }
  }
  return items;
};

// Imports a single Trello board as one Project inside the given channel/tab
const importSingleBoard = async ({ token, boardId, channel, tab, userId, companyId }) => {
  const [board, lists, cards, trelloMembers] = await Promise.all([
    trello.getBoardInfo(token, boardId),
    trello.getBoardLists(token, boardId),
    trello.getBoardCards(token, boardId),
    trello.getBoardMembers(token, boardId),
  ]);

  // Build statusKey map preserving Trello list order
  const sortedLists = [...lists].sort((a, b) => a.pos - b.pos);
  const seenSlugs = new Set();
  const listStatusMap = {};
  // isCompletedStatus intentionally omitted (stays schema default false) — Trello's
  // API has no "done" concept on a list (list.closed is archived/hidden, unrelated
  // to workflow). See docs/superpowers/specs/2026-07-19-import-closing-status-decisions.md.
  const statusDocs = sortedLists.map((list, index) => {
    const slug = ensureUniqueSlug(slugify(list.name), seenSlugs);
    listStatusMap[list.id] = slug;
    return { statusKey: slug, statusName: list.name, color: assignColor(index), order: index + 1, isSystem: false };
  });

  // Match Trello members to existing Boardd users by email
  const trelloEmailMap = {};
  for (const m of trelloMembers) {
    if (m.email) trelloEmailMap[m.email.toLowerCase()] = m.id;
  }
  const trelloEmails = Object.keys(trelloEmailMap);
  const existingUsers = trelloEmails.length
    ? await findManyUsers({ email: { $in: trelloEmails }, companyId })
    : [];
  const memberMap = {};
  for (const u of existingUsers) {
    const tid = trelloEmailMap[u.email.toLowerCase()];
    if (tid) memberMap[tid] = u._id;
  }

  // Create Project (model fn directly — skips initializeSystemStatuses)
  const today = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project = await createProject({
    name: board.name,
    description: board.desc || "",
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

  // Create custom statuses from Trello lists
  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  // Create Tasks (skip closed cards)
  let tasksImported = 0;
  let tasksSkipped = 0;

  for (const card of cards) {
    if (card.closed) { tasksSkipped++; continue; }

    const statusKey = listStatusMap[card.idList] || statusDocs[0]?.statusKey || "todo";
    const assignedTo = (card.idMembers || []).map((mid) => memberMap[mid]).filter(Boolean);
    const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);

    await createTask({
      title: card.name,
      description: card.desc || "",
      projectId: project._id,
      companyId,
      tabId: tab._id,
      createdBy: userId,
      assignedTo,
      status: statusKey,
      priority: "medium",
      dueDate: card.due ? new Date(card.due) : undefined,
      tags: (card.labels || []).map((l) => l.name).filter(Boolean),
      orderIndex: new Map([[statusKey, taskOrderIndex]]),
      checklist: flattenChecklists(card.checklists),
      attachments: (card.attachments || []).map((a) => ({
        url: a.url,
        fileName: a.name,
        fileSize: a.bytes ?? 0,
        mimeType: a.mimeType ?? "application/octet-stream",
        uploadedBy: userId,
        uploadedAt: a.date ? new Date(a.date) : new Date(),
        source: "local",
      })),
    });
    tasksImported++;
  }

  return {
    boardId,
    boardName: board.name,
    projectId: project._id,
    statusesCreated: statusDocs.length,
    tasksImported,
    tasksSkipped,
    membersMatched: existingUsers.length,
  };
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const startTrelloImportWorker = () => {
  const worker = new Worker(
    "trello-import",
    async (job) => {
      const { jobId, userId: userIdStr, token, boardIds, channel, tab, channelId } = job.data;
      const userId    = require("mongoose").Types.ObjectId.createFromHexString(userIdStr);
      const companyId = require("mongoose").Types.ObjectId.createFromHexString(job.data.companyId);

      const progressRef = { current: 0, total: boardIds.length };

      await updateImportJob({ _id: jobId }, { status: "running" });
      emitProgress(userIdStr, jobId, {
        platform: "trello",
        status:   "running",
        progress: { current: 0, total: boardIds.length, currentItem: "Starting import..." },
      });
      console.log(`[Trello Import] Job ${jobId} started — boards: ${boardIds.join(", ")}`);

      const results = [];
      for (const boardId of boardIds) {
        const result = await importSingleBoard({ token, boardId, channel, tab, userId, companyId });

        progressRef.current++;
        console.log(
          `[Trello Import] Board done: ${result.boardName} — ` +
          `${result.tasksImported} tasks imported, ${result.tasksSkipped} skipped`
        );
        emitProgress(userIdStr, jobId, {
          platform: "trello",
          status:   "running",
          progress: { current: progressRef.current, total: boardIds.length, currentItem: result.boardName },
        });
        await updateImportJob({ _id: jobId }, {
          "progress.current":     progressRef.current,
          "progress.total":       boardIds.length,
          "progress.currentItem": result.boardName,
        });

        results.push(result);
      }

      const finalResult = {
        channelId:          channel._id,
        tabId:              tab._id,
        isNewChannel:       !channelId,
        boards:             results,
        totalTasksImported: results.reduce((s, r) => s + r.tasksImported, 0),
        totalTasksSkipped:  results.reduce((s, r) => s + r.tasksSkipped, 0),
      };

      await updateImportJob({ _id: jobId }, {
        status:   "completed",
        result:   finalResult,
        progress: {
          current:     boardIds.length,
          total:       boardIds.length,
          currentItem: "Done",
        },
      });
      emitProgress(userIdStr, jobId, {
        platform: "trello",
        status:   "completed",
        progress: {
          current:     boardIds.length,
          total:       boardIds.length,
          currentItem: "Done",
        },
        result: finalResult,
      });
      console.log(`[Trello Import] Job ${jobId} completed — total: ${finalResult.totalTasksImported} tasks imported`);

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
    console.error(`[Trello Import] Job ${jobId} failed:`, err.message);
    await updateImportJob({ _id: jobId }, { status: "failed", error: err.message });
    emitProgress(userIdStr, jobId, { platform: "trello", status: "failed", error: err.message });
  });

  console.log("✅ Trello import worker started");
  return worker;
};

module.exports = { startTrelloImportWorker };
