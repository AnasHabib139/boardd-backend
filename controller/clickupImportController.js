"use strict";

const { createChannel, updateChannel, findChannel } = require("../models/channelModel");
const { createChannelTab, findChannelTab } = require("../models/channelTabsModel");
const { createChatConversation } = require("../models/chatConversationModel");
const { createProject, getNextProjectOrderIndex } = require("../models/projectModel");
const { createManyTabTaskStatuses } = require("../models/tabTaskStatusModel");
const { createTask, getNextOrderIndex } = require("../models/taskModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser, findManyUsers } = require("../models/userModel");
const clickup = require("../services/clickupService");
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
    for (const item of cl.items || []) {
      items.push({ name: item.name, isCompleted: item.resolved === true, order: order++ });
    }
  }
  return items;
};

const mapPriority = (priority) => {
  if (!priority) return "medium";
  const map = { urgent: "urgent", high: "high", normal: "medium", low: "low" };
  return map[priority.priority] || "medium";
};

// Imports a single ClickUp List as one Project inside the given channel/tab
const importSingleList = async ({ token, list, channel, tab, userId, user, memberMap }) => {
  // Build statusKey map from list's statuses (sorted by orderindex)
  const sortedStatuses = [...(list.statuses || [])].sort((a, b) => a.orderindex - b.orderindex);
  const seenSlugs = new Set();
  const statusKeyMap = {}; // ClickUp status string → Boardd statusKey
  const statusDocs = sortedStatuses.map((s, index) => {
    const slug = ensureUniqueSlug(slugify(s.status), seenSlugs);
    statusKeyMap[s.status] = slug;
    return {
      statusKey: slug,
      statusName: s.status,
      color: s.color || assignColor(index),
      order: index + 1,
      isSystem: false,
    };
  });

  // Fallback if list has no statuses
  if (statusDocs.length === 0) {
    statusDocs.push({ statusKey: "todo", statusName: "To Do", color: "#6C63FF", order: 1, isSystem: false });
  }

  // Create Project (one per List)
  const today = new Date();
  const projectOrderIndex = await getNextProjectOrderIndex(tab._id);
  const project = await createProject({
    name: list.name,
    description: "",
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

  // Create custom statuses from ClickUp list statuses
  await createManyTabTaskStatuses(statusDocs.map((s) => ({ ...s, projectId: project._id })));

  // Paginate through tasks
  let tasksImported = 0;
  let tasksSkipped = 0;
  let page = 0;

  while (true) {
    const tasks = await clickup.getTasksPage(token, list.id, page);
    if (!tasks.length) break;

    for (const task of tasks) {
      // Skip closed tasks and subtasks (parent !== null)
      if (task.status?.type === "closed" || task.parent) { tasksSkipped++; continue; }

      const statusKey = statusKeyMap[task.status?.status] || statusDocs[0].statusKey;
      const assignedTo = (task.assignees || [])
        .map((a) => memberMap[a.email?.toLowerCase()])
        .filter(Boolean);
      const taskOrderIndex = await getNextOrderIndex(project._id, null, statusKey);

      await createTask({
        title: task.name,
        description: task.description || "",
        projectId: project._id,
        companyId: user.companyId,
        tabId: tab._id,
        createdBy: userId,
        assignedTo,
        status: statusKey,
        priority: mapPriority(task.priority),
        dueDate: task.due_date ? new Date(Number(task.due_date)) : undefined,
        tags: (task.tags || []).map((t) => t.name).filter(Boolean),
        orderIndex: new Map([[statusKey, taskOrderIndex]]),
        checklist: flattenChecklists(task.checklists),
      });
      tasksImported++;
    }

    if (tasks.length < 100) break; // last page
    page++;
  }

  return {
    listId: list.id,
    listName: list.name,
    projectId: project._id,
    statusesCreated: statusDocs.length,
    tasksImported,
    tasksSkipped,
  };
};

// Imports a single ClickUp Space: collects all lists (folder + folderless), imports each as a Project
const importSingleSpace = async ({ token, spaceId, spaceName, channel, tab, userId, user }) => {
  const [folders, folderlessLists, spaceMembers] = await Promise.all([
    clickup.getFolders(token, spaceId),
    clickup.getFolderlessLists(token, spaceId),
    clickup.getSpaceMembers(token, spaceId),
  ]);

  // Match ClickUp members to Boardd users by email (one DB query for whole space)
  const emailToMemberId = {};
  for (const m of spaceMembers) {
    if (m.email) emailToMemberId[m.email.toLowerCase()] = m.id;
  }
  const emails = Object.keys(emailToMemberId);
  const existingUsers = emails.length
    ? await findManyUsers({ email: { $in: emails }, companyId: user.companyId })
    : [];
  const memberMap = {}; // ClickUp member email → Boardd userId
  for (const u of existingUsers) {
    memberMap[u.email.toLowerCase()] = u._id;
  }

  // Collect all lists: folderless + from each folder (statuses already on list objects)
  const folderLists = [];
  for (const folder of folders) {
    const lists = await clickup.getFolderLists(token, folder.id);
    folderLists.push(...lists);
  }
  const allLists = [...folderlessLists, ...folderLists];

  // Import each list as a Project (sequential to avoid orderIndex collisions)
  const listResults = [];
  for (const list of allLists) {
    const result = await importSingleList({ token, list, channel, tab, userId, user, memberMap });
    listResults.push(result);
  }

  return {
    spaceId,
    spaceName,
    listsImported: listResults.length,
    totalTasksImported: listResults.reduce((s, r) => s + r.tasksImported, 0),
    totalTasksSkipped: listResults.reduce((s, r) => s + r.tasksSkipped, 0),
  };
};

// ─── Controllers ────────────────────────────────────────────────────────────

exports.getAuthUrl = async (req, res, next) => {
  try {
    return generateResponse({ authUrl: clickup.getAuthUrl() }, "ClickUp auth URL", res);
  } catch (error) {
    return next(error);
  }
};

exports.connectClickUp = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    const { access_token } = await clickup.exchangeCode(code);
    const cuUser = await clickup.getAuthorizedUser(access_token);

    await updateUserIntegration(
      { userId, platform: "clickup" },
      { accessToken: access_token, platformUserId: String(cuUser.user?.id || ""), platformUserName: cuUser.user?.username || "", isActive: true },
      { upsert: true }
    );

    return generateResponse(
      { username: cuUser.user?.username, email: cuUser.user?.email },
      "ClickUp connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getClickUpSpaces = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "clickup", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "ClickUp not connected" });
    }

    const workspaces = await clickup.getWorkspaces(integration.accessToken);
    const spaces = [];
    for (const workspace of workspaces) {
      const workspaceSpaces = await clickup.getSpaces(integration.accessToken, workspace.id);
      for (const space of workspaceSpaces) {
        spaces.push({ id: space.id, name: space.name, workspaceId: workspace.id, workspaceName: workspace.name });
      }
    }

    return generateResponse(spaces, "Spaces fetched", res);
  } catch (error) {
    return next(error);
  }
};

exports.disconnectClickUp = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "clickup" });
    return generateResponse({}, "ClickUp disconnected", res);
  } catch (error) {
    return next(error);
  }
};

exports.importClickUpSpaces = async (req, res, next) => {
  try {
    const { spaceIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user = await findUser({ _id: userId });

    // 1. Get stored token
    const integration = await findUserIntegration({ userId, platform: "clickup", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "ClickUp not connected" });
    }
    const token = integration.accessToken;

    // 2. Resolve channel + tab
    let channel, tab;

    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      }
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
      }
    } else {
      const resolvedName = channelName || "ClickUp Import";

      channel = await createChannel({
        channelName: resolvedName,
        channelDescription: "Imported from ClickUp",
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

    // 3. Fetch space names (needed for results) and import each space
    const workspaces = await clickup.getWorkspaces(token);
    const spaceNameMap = {};
    for (const workspace of workspaces) {
      const spaces = await clickup.getSpaces(token, workspace.id);
      for (const space of spaces) {
        spaceNameMap[space.id] = space.name;
      }
    }

    const results = [];
    for (const spaceId of spaceIds) {
      const spaceName = spaceNameMap[spaceId] || spaceId;
      const result = await importSingleSpace({ token, spaceId, spaceName, channel, tab, userId, user });
      results.push(result);
    }

    return generateResponse(
      {
        channelId: channel._id,
        tabId: tab._id,
        isNewChannel: !channelId,
        spaces: results,
        totalTasksImported: results.reduce((s, r) => s + r.totalTasksImported, 0),
        totalTasksSkipped: results.reduce((s, r) => s + r.totalTasksSkipped, 0),
      },
      "ClickUp spaces imported successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};
