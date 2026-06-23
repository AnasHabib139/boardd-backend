"use strict";

const { createChannel, updateChannel, findChannel }                         = require("../models/channelModel");
const { createChannelTab, findChannelTab }                                  = require("../models/channelTabsModel");
const { createChatConversation }                                            = require("../models/chatConversationModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const notion                                                                = require("../services/notionService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { generateJoinToken }                                                 = require("./helpers/users/signup.helper");
const { getNotionImportQueue }                                              = require("../jobs/notionImportQueue");
const { createImportJob, findImportJob }                                    = require("../models/importJobModel");

// ─── Token refresh helper ────────────────────────────────────────────────────

const getValidToken = async (integration) => {
  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring  = !integration.tokenExpiry ||
    new Date(integration.tokenExpiry).getTime() - Date.now() < fiveMinutes;

  if (!isExpiring) return integration.accessToken;

  const refreshed      = await notion.refreshAccessToken(integration.refreshToken);
  const expiresInMs    = (refreshed.expires_in ?? 60 * 24 * 60 * 60) * 1000;
  const expiry         = new Date(Date.now() + expiresInMs);
  await updateUserIntegration(
    { _id: integration._id },
    { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, tokenExpiry: expiry }
  );
  return refreshed.access_token;
};

// ─── Handlers ────────────────────────────────────────────────────────────────

exports.getAuthUrl = async (req, res, next) => {
  try {
    return generateResponse({ authUrl: notion.getAuthUrl() }, "Notion auth URL", res);
  } catch (error) {
    return next(error);
  }
};

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

    // Resolve channel + tab
    let channel, tab;
    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
    } else {
      const resolvedName = channelName || "Notion Import";
      channel = await createChannel({
        channelName:        resolvedName,
        channelDescription: "Imported from Notion",
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
    const job = await createImportJob({ userId, platform: "notion", status: "pending" });
    await getNotionImportQueue().add("import", {
      jobId:                   job._id.toString(),
      userId:                  userId.toString(),
      companyId:               user.companyId.toString(),
      token,
      refreshToken:            integration.refreshToken,
      tokenExpiry:             integration.tokenExpiry,
      workspaceId:             integration.cloudId,
      databaseIds,
      pageIds,
      databaseNameMap,
      pageNameMap,
      notionPagesProjectName:  notionPagesName || "Notion Pages",
      channel:                 { _id: channel._id.toString() },
      tab:                     { _id: tab._id.toString() },
      channelId:               channelId || null,
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

exports.disconnectNotion = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "notion" });
    return generateResponse({}, "Notion disconnected", res);
  } catch (error) {
    return next(error);
  }
};
