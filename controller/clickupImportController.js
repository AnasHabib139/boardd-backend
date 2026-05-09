"use strict";

const { createChannel, updateChannel, findChannel } = require("../models/channelModel");
const { createChannelTab, findChannelTab } = require("../models/channelTabsModel");
const { createChatConversation } = require("../models/chatConversationModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser } = require("../models/userModel");
const clickup = require("../services/clickupService");
const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { generateJoinToken } = require("./helpers/users/signup.helper");
const { getImportQueue } = require("../jobs/clickupImportQueue");
const { createImportJob, findImportJob } = require("../models/importJobModel");

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

    const integration = await findUserIntegration({ userId, platform: "clickup", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "ClickUp not connected" });
    }
    const token = integration.accessToken;

    // Resolve channel + tab
    let channel, tab;
    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
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

    // Fetch space names for progress display
    const workspaces = await clickup.getWorkspaces(token);
    const spaceNameMap = {};
    for (const workspace of workspaces) {
      const spaces = await clickup.getSpaces(token, workspace.id);
      for (const space of spaces) spaceNameMap[space.id] = space.name;
    }

    // Create job record
    const job = await createImportJob({ userId, platform: "clickup", status: "pending" });

    // Enqueue — worker runs in background
    await getImportQueue().add("import", {
      jobId: job._id.toString(),
      userId: userId.toString(),
      companyId: user.companyId.toString(),
      token,
      spaceIds,
      spaceNameMap,
      channel: { _id: channel._id.toString() },
      tab: { _id: tab._id.toString() },
      channelId: channelId || null,
    });

    return generateResponse(
      { jobId: job._id, channelId: channel._id, tabId: tab._id, isNewChannel: !channelId },
      "Import started",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getImportStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await findImportJob({ _id: jobId, userId: req.user.id });
    if (!job) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Import job not found" });
    return generateResponse(job, "Import status", res);
  } catch (error) {
    return next(error);
  }
};
