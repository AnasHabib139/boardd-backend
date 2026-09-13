"use strict";

const { findUserIntegration, updateUserIntegration }                       = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const jira                                                                  = require("../services/jiraService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { getJiraImportQueue }                                                = require("../jobs/jiraImportQueue");
const { getValidToken: getValidTokenGeneric }                               = require("./helpers/imports/tokenRefresh.helper");
const { resolveImportChannel }      = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler }     = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler }     = require("./helpers/imports/disconnectIntegration.helper");

// ─── Token refresh helper ────────────────────────────────────────────────────

const getValidToken = (integration) =>
  getValidTokenGeneric(integration, (refreshToken) => jira.refreshAccessToken(refreshToken));

// ─── Handlers ────────────────────────────────────────────────────────────────

exports.getAuthUrl = makeGetAuthUrlHandler(jira, "Jira");

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

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "Jira",
      defaultName: "Jira Import",
    });

    // Build projectNameMap
    const allProjects    = await jira.getProjects(token, cloudId);
    const projectNameMap = {};
    const projectKeyMap  = {};
    for (const p of allProjects) {
      projectNameMap[p.id] = p.name;
      projectKeyMap[p.id]  = p.key;
    }

    // Create job and enqueue
    const { jobId } = await createAndEnqueueImportJob({
      platform: "jira",
      queue: getJiraImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token,
        refreshToken: integration.refreshToken,
        tokenExpiry: integration.tokenExpiry,
        cloudId,
        projectIds,
        projectNameMap,
        projectKeyMap,
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

exports.disconnectJira = makeDisconnectHandler("jira", "Jira");
