"use strict";

const { createChannel, updateChannel, findChannel }                         = require("../models/channelModel");
const { createChannelTab, findChannelTab }                                  = require("../models/channelTabsModel");
const { createChatConversation }                                            = require("../models/chatConversationModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const linear                                                                = require("../services/linearService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { generateJoinToken }                                                 = require("./helpers/users/signup.helper");
const { getLinearImportQueue }                                              = require("../jobs/linearImportQueue");
const { createImportJob, findImportJob }                                    = require("../models/importJobModel");

// ─── Token refresh helper ────────────────────────────────────────────────────

const getValidToken = async (integration) => {
  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring  = !integration.tokenExpiry ||
    new Date(integration.tokenExpiry).getTime() - Date.now() < fiveMinutes;

  if (!isExpiring) return integration.accessToken;

  const refreshed = await linear.refreshAccessToken(integration.refreshToken);
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
    return generateResponse({ authUrl: linear.getAuthUrl() }, "Linear auth URL", res);
  } catch (error) {
    return next(error);
  }
};

exports.connectLinear = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const tokenResponse = await linear.exchangeCode(code);
    const { access_token, refresh_token, expires_in } = tokenResponse;
    const tokenExpiry = new Date(Date.now() + expires_in * 1000);

    // Fetch workspace info to store as cloudName / platformUserName
    let me = null;
    try { me = await linear.getMe(access_token); } catch (_) {}

    await updateUserIntegration(
      { userId, platform: "linear" },
      {
        accessToken:      access_token,
        refreshToken:     refresh_token,
        tokenExpiry,
        platformUserId:   me?.id   || "",
        platformUserName: me?.name || "",
        isActive:         true,
      },
      { upsert: true }
    );

    return generateResponse(
      { workspaceName: me?.name || "Linear Workspace" },
      "Linear connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getLinearTeams = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "linear", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Linear not connected" });

    const token = await getValidToken(integration);
    const teams = await linear.listTeams(token);

    return generateResponse(
      teams.map((t) => ({ id: t.id, name: t.name })),
      "Teams fetched",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.importLinearTeams = async (req, res, next) => {
  try {
    const { teamIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "linear", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Linear not connected" });

    const token = await getValidToken(integration);

    // Fetch all teams to build teamNameMap
    const allTeams   = await linear.listTeams(token);
    const teamNameMap = {};
    for (const t of allTeams) { teamNameMap[t.id] = t.name; }

    // Resolve channel + tab (same pattern as Jira/Notion)
    let channel, tab;
    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
    } else {
      const resolvedName = channelName || "Linear Import";
      channel = await createChannel({
        channelName:        resolvedName,
        channelDescription: "Imported from Linear",
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

    const job = await createImportJob({ userId, platform: "linear", status: "pending" });
    await getLinearImportQueue().add("import", {
      jobId:        job._id.toString(),
      userId:       userId.toString(),
      companyId:    user.companyId.toString(),
      token,
      refreshToken: integration.refreshToken,
      tokenExpiry:  integration.tokenExpiry,
      teamIds,
      teamNameMap,
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

exports.disconnectLinear = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "linear" });
    return generateResponse({}, "Linear disconnected", res);
  } catch (error) {
    return next(error);
  }
};
