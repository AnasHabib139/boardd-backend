"use strict";

const { findUserIntegration, updateUserIntegration }                       = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const linear                                                                = require("../services/linearService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { getLinearImportQueue }                                              = require("../jobs/linearImportQueue");
const { getValidToken: getValidTokenGeneric }                               = require("./helpers/imports/tokenRefresh.helper");
const { resolveImportChannel } = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler } = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler } = require("./helpers/imports/disconnectIntegration.helper");

// ─── Token refresh helper ────────────────────────────────────────────────────

const getValidToken = (integration) =>
  getValidTokenGeneric(integration, (refreshToken) => linear.refreshAccessToken(refreshToken));

// ─── Handlers ────────────────────────────────────────────────────────────────

exports.getAuthUrl = makeGetAuthUrlHandler(linear, "Linear");

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

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "Linear",
      defaultName: "Linear Import",
    });

    const { jobId } = await createAndEnqueueImportJob({
      platform: "linear",
      queue: getLinearImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token,
        refreshToken: integration.refreshToken,
        tokenExpiry: integration.tokenExpiry,
        teamIds,
        teamNameMap,
        channel: { _id: channel._id.toString() },
        tab: { _id: tab._id.toString() },
        channelId: channelId || null,
      },
    });

    return generateResponse(
      { jobId, channelId: channel._id, tabId: tab._id, isNewChannel },
      "Import started",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getImportStatus = require("./helpers/imports/importStatus.helper").getImportStatus;

exports.disconnectLinear = makeDisconnectHandler("linear", "Linear");
