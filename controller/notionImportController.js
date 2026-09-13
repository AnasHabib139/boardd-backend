"use strict";

const { findUserIntegration, updateUserIntegration }                       = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const notion                                                                = require("../services/notionService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { getNotionImportQueue }                                              = require("../jobs/notionImportQueue");
const { getValidToken: getValidTokenGeneric }                               = require("./helpers/imports/tokenRefresh.helper");
const { resolveImportChannel } = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler } = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler } = require("./helpers/imports/disconnectIntegration.helper");

// ─── Token refresh helper ────────────────────────────────────────────────────

const getValidToken = (integration) =>
  getValidTokenGeneric(integration, (refreshToken) => notion.refreshAccessToken(refreshToken));

// ─── Handlers ────────────────────────────────────────────────────────────────

exports.getAuthUrl = makeGetAuthUrlHandler(notion, "Notion");

exports.connectNotion = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const data = await notion.exchangeCode(code);
    const {
      access_token,
      refresh_token,
      workspace_id,
      workspace_name,
      bot_id,
      owner,
    } = data;

    const expiresInMs  = (data.expires_in ?? 60 * 24 * 60 * 60) * 1000;
    const tokenExpiry  = new Date(Date.now() + expiresInMs);
    const ownerName    = (owner && (owner.name || owner?.person?.email)) || "";

    await updateUserIntegration(
      { userId, platform: "notion" },
      {
        accessToken:      access_token,
        refreshToken:     refresh_token,
        tokenExpiry,
        cloudId:          workspace_id,
        cloudName:        workspace_name,
        platformUserId:   bot_id || "",
        platformUserName: ownerName,
        isActive:         true,
      },
      { upsert: true }
    );

    return generateResponse(
      { workspaceId: workspace_id, workspaceName: workspace_name },
      "Notion connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getNotionItems = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "notion", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Notion not connected" });

    const token = await getValidToken(integration);

    const [databases, pages] = await Promise.all([
      notion.listDatabases(token),
      notion.listStandalonePages(token),
    ]);

    return generateResponse({ databases, pages }, "Notion items fetched", res);
  } catch (error) {
    return next(error);
  }
};

exports.importNotion = async (req, res, next) => {
  try {
    const { databaseIds, pageIds, notionPagesName, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "notion", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Notion not connected" });

    const token = await getValidToken(integration);

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "Notion",
      defaultName: "Notion Import",
    });

    // Build name maps
    const [allDatabases, allPages] = await Promise.all([
      notion.listDatabases(token),
      notion.listStandalonePages(token),
    ]);

    const databaseNameMap = {};
    for (const db of allDatabases) {
      if (!databaseIds || databaseIds.includes(db.id)) {
        databaseNameMap[db.id] = db.title;
      }
    }

    const pageNameMap = {};
    for (const page of allPages) {
      if (!pageIds || pageIds.includes(page.id)) {
        pageNameMap[page.id] = page.title;
      }
    }

    // Create job and enqueue
    const { jobId } = await createAndEnqueueImportJob({
      platform: "notion",
      queue: getNotionImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token,
        refreshToken: integration.refreshToken,
        tokenExpiry: integration.tokenExpiry,
        workspaceId: integration.cloudId,
        databaseIds,
        pageIds,
        databaseNameMap,
        pageNameMap,
        notionPagesProjectName: notionPagesName || "Notion Pages",
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

exports.disconnectNotion = makeDisconnectHandler("notion", "Notion");
