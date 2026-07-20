"use strict";

const { createChannel, updateChannel, findChannel } = require("../models/channelModel");
const { createChannelTab, findChannelTab } = require("../models/channelTabsModel");
const { createChatConversation } = require("../models/chatConversationModel");
const { createProject, getNextProjectOrderIndex } = require("../models/projectModel");
const { createManyTabTaskStatuses } = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex } = require("../models/taskModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser, findManyUsers } = require("../models/userModel");
const trello = require("../services/trelloService");
const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { generateJoinToken } = require("./helpers/users/signup.helper");

// ─── Private helpers ────────────────────────────────────────────────────────

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

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
    for (const item of cl.checkItems || []) {
      items.push({ name: item.name, isCompleted: item.state === "complete", order: order++ });
    }
  }
  return items;
};

// Imports a single Trello board as one Project inside the given channel/tab
const importSingleBoard = async ({ token, boardId, channel, tab, userId, user }) => {
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
    ? await findManyUsers({ email: { $in: trelloEmails }, companyId: user.companyId })
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
    companyId: user.companyId,
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
      companyId: user.companyId,
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

// ─── Controllers ────────────────────────────────────────────────────────────

exports.getAuthUrl = async (req, res, next) => {
  try {
    return generateResponse({ authUrl: trello.getAuthUrl() }, "Trello auth URL", res);
  } catch (error) {
    return next(error);
  }
};

exports.connectTrello = async (req, res, next) => {
  try {
    const { token } = req.body;
    const userId = req.user.id;

    const member = await trello.validateToken(token);

    await updateUserIntegration(
      { userId, platform: "trello" },
      { accessToken: token, platformUserId: member.id, platformUserName: member.username, isActive: true },
      { upsert: true }
    );

    return generateResponse(
      { username: member.username, fullName: member.fullName },
      "Trello connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getTrelloBoards = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "trello", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Trello not connected" });
    }

    const boards = await trello.getMemberBoards(integration.accessToken);
    return generateResponse(
      boards.map((b) => ({ id: b.id, name: b.name, desc: b.desc })),
      "Boards fetched",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.disconnectTrello = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "trello" });
    return generateResponse({}, "Trello disconnected", res);
  } catch (error) {
    return next(error);
  }
};

exports.importTrelloBoard = async (req, res, next) => {
  try {
    const { boardIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user = await findUser({ _id: userId });

    // 1. Get stored token
    const integration = await findUserIntegration({ userId, platform: "trello", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Trello not connected" });
    }
    const token = integration.accessToken;

    // 2. Resolve channel + tab
    let channel, tab;

    if (channelId) {
      // Use existing channel
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      }
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
      }
    } else {
      // Create new channel
      const resolvedName = channelName || "Trello Import";

      channel = await createChannel({
        channelName: resolvedName,
        channelDescription: "Imported from Trello",
        companyId: user.companyId,
        isPrivate: false,
        createdBy: userId,
        channelToken: generateJoinToken(),
        members: [userId],
      });

      await createChatConversation({
        companyId: user.companyId,
        type: "channel",
        channelId: channel._id,
        participantIds: [],
        participants: [{ userId, lastReadAt: null }],
        createdBy: userId,
      });

      tab = await createChannelTab({
        channelId: channel._id,
        tabName: "task management",
        isDefault: true,
        members: [userId],
        createdBy: userId,
        companyId: user.companyId,
        isPrivate: false,
      });

      await updateChannel({ _id: channel._id }, { $push: { tabs: tab._id } });
    }

    // 3. Import each board as a separate Project (sequential to avoid collisions)
    const results = [];
    for (const boardId of boardIds) {
      const result = await importSingleBoard({ token, boardId, channel, tab, userId, user });
      results.push(result);
    }

    return generateResponse(
      {
        channelId: channel._id,
        tabId: tab._id,
        isNewChannel: !channelId,
        boards: results,
        totalTasksImported: results.reduce((s, r) => s + r.tasksImported, 0),
        totalTasksSkipped: results.reduce((s, r) => s + r.tasksSkipped, 0),
      },
      "Trello boards imported successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};
