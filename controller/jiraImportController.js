"use strict";

const { createChannel, updateChannel, findChannel }                         = require("../models/channelModel");
const { createChannelTab, findChannelTab }                                  = require("../models/channelTabsModel");
const { createChatConversation }                                            = require("../models/chatConversationModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const jira                                                                  = require("../services/jiraService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { generateJoinToken }                                                 = require("./helpers/users/signup.helper");
const { getJiraImportQueue }                                                = require("../jobs/jiraImportQueue");
const { createImportJob, findImportJob }                                    = require("../models/importJobModel");

// ─── Token refresh helper ────────────────────────────────────────────────────

const getValidToken = async (integration) => {
  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring  = !integration.tokenExpiry ||
    new Date(integration.tokenExpiry).getTime() - Date.now() < fiveMinutes;

  if (!isExpiring) return integration.accessToken;

  const refreshed = await jira.refreshAccessToken(integration.refreshToken);
  const expiry    = new Date(Date.now() + refreshed.expires_in * 1000);
  await updateUserIntegration(
    { _id: integration._id },
    { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, tokenExpiry: expiry }
  );
  return refreshed.access_token;
};

// ─── Handlers ────────────────────────────────────────────────────────────────

exports.getAuthUrl = async (req, res, next) => {
  try {
    return generateResponse({ authUrl: jira.getAuthUrl() }, "Jira auth URL", res);
  } catch (error) {
    return next(error);
  }
};

exports.connectJira = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const tokenResponse = await jira.exchangeCode(code);
    const { access_token, refresh_token, expires_in } = tokenResponse;
    const tokenExpiry = new Date(Date.now() + expires_in * 1000);

    const sites = await jira.getAccessibleResources(access_token);

    if (sites.length === 1) {
      let meUser = null;
      try { meUser = await jira.getMe(access_token, sites[0].id); } catch (_) {}

      await updateUserIntegration(
        { userId, platform: "jira" },
        {
          accessToken:      access_token,
          refreshToken:     refresh_token,
          tokenExpiry,
          cloudId:          sites[0].id,
          cloudName:        sites[0].name,
          platformUserId:   meUser?.accountId || "",
          platformUserName: meUser?.displayName || "",
          isActive:         true,
        },
        { upsert: true }
      );
    } else {
      // Multiple sites — store tokens, wait for select-site call
      await updateUserIntegration(
        { userId, platform: "jira" },
        {
          accessToken:  access_token,
          refreshToken: refresh_token,
          tokenExpiry,
          cloudId:      "",
          isActive:     true,
        },
        { upsert: true }
      );
    }

    return generateResponse(
      { sites: sites.map(s => ({ id: s.id, name: s.name, url: s.url, avatarUrl: s.avatarUrl })), autoSelected: sites.length === 1 },
      "Jira connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.selectSite = async (req, res, next) => {
  try {
    const { cloudId, cloudName } = req.body;
    const userId = req.user.id;

    const integration = await findUserIntegration({ userId, platform: "jira", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Jira not connected" });

    const token = await getValidToken(integration);

    let meUser = null;
    try { meUser = await jira.getMe(token, cloudId); } catch (_) {}

    await updateUserIntegration(
      { _id: integration._id },
      {
        cloudId,
        cloudName,
        platformUserId:   meUser?.accountId || "",
        platformUserName: meUser?.displayName || "",
      }
    );

    return generateResponse({ cloudName }, "Jira site selected", res);
  } catch (error) {
    return next(error);
  }
};

exports.getJiraProjects = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "jira", isActive: true });
    if (!integration || !integration.cloudId)
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Jira not connected or site not selected" });

    const token    = await getValidToken(integration);
    const projects = await jira.getProjects(token, integration.cloudId);

    return generateResponse(
      projects.map(p => ({ id: p.id, key: p.key, name: p.name })),
      "Projects fetched",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.importJiraProjects = async (req, res, next) => {
  try {
    const { projectIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "jira", isActive: true });
    if (!integration || !integration.cloudId)
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Jira not connected or site not selected" });

    const token   = await getValidToken(integration);
    const cloudId = integration.cloudId;

    // Resolve channel + tab
    let channel, tab;
    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
    } else {
      const resolvedName = channelName || "Jira Import";
      channel = await createChannel({
        channelName:        resolvedName,
        channelDescription: "Imported from Jira",
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

    // Build projectNameMap
    const allProjects    = await jira.getProjects(token, cloudId);
    const projectNameMap = {};
    const projectKeyMap  = {};
    for (const p of allProjects) {
      projectNameMap[p.id] = p.name;
      projectKeyMap[p.id]  = p.key;
    }

    // Create job and enqueue
    const job = await createImportJob({ userId, platform: "jira", status: "pending" });
    await getJiraImportQueue().add("import", {
      jobId:        job._id.toString(),
      userId:       userId.toString(),
      companyId:    user.companyId.toString(),
      token,
      refreshToken: integration.refreshToken,
      tokenExpiry:  integration.tokenExpiry,
      cloudId,
      projectIds,
      projectNameMap,
      projectKeyMap,
      channel:      { _id: channel._id.toString() },
      tab:          { _id: tab._id.toString() },
      channelId:    channelId || null,
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

exports.disconnectJira = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "jira" });
    return generateResponse({}, "Jira disconnected", res);
  } catch (error) {
    return next(error);
  }
};
