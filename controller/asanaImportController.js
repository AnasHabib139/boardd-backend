"use strict";

const { createChannel, updateChannel, findChannel }                        = require("../models/channelModel");
const { createChannelTab, findChannelTab }                                 = require("../models/channelTabsModel");
const { createChatConversation }                                           = require("../models/chatConversationModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser }                                                         = require("../models/userModel");
const asana                                                                = require("../services/asanaService");
const { generateResponse }                                                 = require("../utils");
const { STATUS_CODES }                                                     = require("../utils/constants");
const { generateJoinToken }                                                = require("./helpers/users/signup.helper");
const { getAsanaImportQueue }                                              = require("../jobs/asanaImportQueue");
const { createImportJob, findImportJob }                                   = require("../models/importJobModel");

// ─── Controllers ──────────────────────────────────────────────────────────────

exports.getAuthUrl = async (req, res, next) => {
  try {
    return generateResponse({ authUrl: asana.getAuthUrl() }, "Asana auth URL", res);
  } catch (error) {
    return next(error);
  }
};

exports.connectAsana = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const tokenResponse = await asana.exchangeCode(code);
    const { access_token } = tokenResponse;
    const asanaUser = tokenResponse.data; // { id, name, email } — lives in .data, not .user

    await updateUserIntegration(
      { userId, platform: "asana" },
      {
        accessToken:      access_token,
        platformUserId:   String(asanaUser?.id || ""),
        platformUserName: asanaUser?.name || "",
        isActive:         true,
      },
      { upsert: true }
    );

    return generateResponse(
      { username: asanaUser?.name, email: asanaUser?.email },
      "Asana connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getAsanaProjects = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "asana", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Asana not connected" });
    }

    const workspaces = await asana.getWorkspaces(integration.accessToken);
    const projects   = [];
    for (const ws of workspaces) {
      const wsProjects = await asana.getProjects(integration.accessToken, ws.gid);
      for (const p of wsProjects) {
        projects.push({ id: p.gid, name: p.name, workspaceId: ws.gid, workspaceName: ws.name });
      }
    }

    return generateResponse(projects, "Projects fetched", res);
  } catch (error) {
    return next(error);
  }
};

exports.disconnectAsana = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "asana" });
    return generateResponse({}, "Asana disconnected", res);
  } catch (error) {
    return next(error);
  }
};

exports.importAsanaProjects = async (req, res, next) => {
  try {
    const { projectIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "asana", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Asana not connected" });
    }
    const token = integration.accessToken;

    // ── Resolve channel + tab (identical pattern to ClickUp) ─────────────────
    let channel, tab;
    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
    } else {
      const resolvedName = channelName || "Asana Import";
      channel = await createChannel({
        channelName:        resolvedName,
        channelDescription: "Imported from Asana",
        companyId:          user.companyId,
        isPrivate:          false,
        createdBy:          userId,
        channelToken:       generateJoinToken(),
        members:            [userId],
      });
      await createChatConversation({
        companyId:      user.companyId,
        type:           "channel",
        channelId:      channel._id,
        participantIds: [],
        participants:   [{ userId, lastReadAt: null }],
        createdBy:      userId,
      });
      tab = await createChannelTab({
        channelId: channel._id,
        tabName:   "task management",
        isDefault: true,
        members:   [userId],
        createdBy: userId,
        companyId: user.companyId,
        isPrivate: false,
      });
      await updateChannel({ _id: channel._id }, { $push: { tabs: tab._id } });
    }

    // ── Build projectNameMap for progress display ──────────────────────────────
    const workspaces     = await asana.getWorkspaces(token);
    const projectNameMap = {};
    for (const ws of workspaces) {
      const projects = await asana.getProjects(token, ws.gid);
      for (const p of projects) projectNameMap[p.gid] = p.name;
    }

    // ── Create job record & enqueue ───────────────────────────────────────────
    const job = await createImportJob({ userId, platform: "asana", status: "pending" });

    await getAsanaImportQueue().add("import", {
      jobId:          job._id.toString(),
      userId:         userId.toString(),
      companyId:      user.companyId.toString(),
      token,
      projectIds,
      projectNameMap,
      channel:        { _id: channel._id.toString() },
      tab:            { _id: tab._id.toString() },
      channelId:      channelId || null,
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
