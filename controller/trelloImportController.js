"use strict";

const { createChannel, updateChannel } = require("../models/channelModel");
const { createChannelTab } = require("../models/channelTabsModel");
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
      items.push({
        name: item.name,
        isCompleted: item.state === "complete",
        order: order++,
      });
    }
  }
  return items;
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
      {
        accessToken: token,
        platformUserId: member.id,
        platformUserName: member.username,
        isActive: true,
      },
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
    const userId = req.user.id;

    const integration = await findUserIntegration({ userId, platform: "trello", isActive: true });
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
    const { boardId } = req.body;
    const userId = req.user.id;
    const user = await findUser({ _id: userId });

    // 1. Get stored token
    const integration = await findUserIntegration({ userId, platform: "trello", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Trello not connected" });
    }
    const token = integration.accessToken;

    // 2. Fetch board data in parallel
    const [board, lists, cards, trelloMembers] = await Promise.all([
      trello.getBoardInfo(token, boardId),
      trello.getBoardLists(token, boardId),
      trello.getBoardCards(token, boardId),
      trello.getBoardMembers(token, boardId),
    ]);

    // 3. Build statusKey map from Trello lists (preserve order by pos)
    const sortedLists = [...lists].sort((a, b) => a.pos - b.pos);
    const seenSlugs = new Set();
    const listStatusMap = {}; // trelloListId → statusKey

    const statusDocs = sortedLists.map((list, index) => {
      const slug = ensureUniqueSlug(slugify(list.name), seenSlugs);
      listStatusMap[list.id] = slug;
      return {
        statusKey: slug,
        statusName: list.name,
        color: assignColor(index),
        order: index + 1,
        isSystem: false,
      };
    });

    // 4. Match Trello members to existing Boardd users by email
    const trelloEmailMap = {}; // email → trello memberId
    for (const m of trelloMembers) {
      if (m.email) trelloEmailMap[m.email.toLowerCase()] = m.id;
    }
    const trelloEmails = Object.keys(trelloEmailMap);
    const existingUsers = trelloEmails.length
      ? await findManyUsers({ email: { $in: trelloEmails }, companyId: user.companyId })
      : [];

    // trelloMemberId → boardd ObjectId
    const memberMap = {};
    for (const u of existingUsers) {
      const trelloId = trelloEmailMap[u.email.toLowerCase()];
      if (trelloId) memberMap[trelloId] = u._id;
    }

    // 5. Create Channel
    const channel = await createChannel({
      channelName: board.name,
      channelDescription: board.desc || `Imported from Trello`,
      companyId: user.companyId,
      isPrivate: false,
      createdBy: userId,
      channelToken: generateJoinToken(),
      members: [userId],
    });

    // 6. Create Chat Conversation
    await createChatConversation({
      companyId: user.companyId,
      type: "channel",
      channelId: channel._id,
      participantIds: [],
      participants: [{ userId, lastReadAt: null }],
      createdBy: userId,
    });

    // 7. Create default task management tab
    const tab = await createChannelTab({
      channelId: channel._id,
      tabName: "task management",
      isDefault: true,
      members: [userId],
      createdBy: userId,
      companyId: user.companyId,
      isPrivate: false,
    });
    await updateChannel({ _id: channel._id }, { $push: { tabs: tab._id } });

    // 8. Create Project (call model fn directly — skips initializeSystemStatuses)
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

    // 9. Create custom statuses from Trello lists
    await createManyTabTaskStatuses(
      statusDocs.map((s) => ({ ...s, projectId: project._id }))
    );

    // 10. Import cards as tasks (skip closed cards)
    let tasksImported = 0;
    let tasksSkipped = 0;

    for (const card of cards) {
      if (card.closed) { tasksSkipped++; continue; }

      const statusKey = listStatusMap[card.idList] || statusDocs[0]?.statusKey || "todo";
      const assignedTo = (card.idMembers || [])
        .map((mid) => memberMap[mid])
        .filter(Boolean);
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

    return generateResponse(
      {
        channelId: channel._id,
        projectId: project._id,
        tabId: tab._id,
        statusesCreated: statusDocs.length,
        tasksImported,
        tasksSkipped,
        membersMatched: existingUsers.length,
      },
      "Trello board imported successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};
