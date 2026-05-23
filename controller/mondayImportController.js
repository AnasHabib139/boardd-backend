"use strict";

const { createChannel, updateChannel, findChannel }                         = require("../models/channelModel");
const { createChannelTab, findChannelTab }                                  = require("../models/channelTabsModel");
const { createChatConversation }                                            = require("../models/chatConversationModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const monday                                                                = require("../services/mondayService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { generateJoinToken }                                                 = require("./helpers/users/signup.helper");
const { getMondayImportQueue }                                              = require("../jobs/mondayImportQueue");
const { createImportJob, findImportJob }                                    = require("../models/importJobModel");

exports.getAuthUrl = async (req, res, next) => {
  try {
    return generateResponse({ authUrl: monday.getAuthUrl() }, "Monday auth URL", res);
  } catch (error) {
    return next(error);
  }
};

exports.connectMonday = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const tokenResponse = await monday.exchangeCode(code);
    const { access_token } = tokenResponse;
    // Monday doesn't include user info in token response — fetch separately
    const meUser = await monday.getMe(access_token);

    await updateUserIntegration(
      { userId, platform: "monday" },
      {
        accessToken:      access_token,
        platformUserId:   String(meUser?.id || ""),
        platformUserName: meUser?.name || "",
        isActive:         true,
      },
      { upsert: true }
    );

    return generateResponse(
      { username: meUser?.name },
      "Monday connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getMondayBoards = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "monday", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Monday not connected" });

    const boards = await monday.getBoards(integration.accessToken);
    const result = boards.map(b => ({
      id:            b.id,
      name:          b.name,
      workspaceId:   b.workspace?.id || null,
      workspaceName: b.workspace?.name || null,
    }));

    return generateResponse(result, "Boards fetched", res);
  } catch (error) {
    return next(error);
  }
};

exports.disconnectMonday = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "monday" });
    return generateResponse({}, "Monday disconnected", res);
  } catch (error) {
    return next(error);
  }
};

exports.importMondayBoards = async (req, res, next) => {
  try {
    const { boardIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "monday", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Monday not connected" });
    const token = integration.accessToken;

    // Resolve channel + tab (identical pattern to Asana/ClickUp)
    let channel, tab;
    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
    } else {
      const resolvedName = channelName || "Monday Import";
      channel = await createChannel({
        channelName:        resolvedName,
        channelDescription: "Imported from Monday.com",
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

    // Build boardNameMap for progress display
    const allBoards    = await monday.getBoards(token);
    const boardNameMap = {};
    for (const b of allBoards) boardNameMap[b.id] = b.name;

    // Create job and enqueue
    const job = await createImportJob({ userId, platform: "monday", status: "pending" });
    await getMondayImportQueue().add("import", {
      jobId:        job._id.toString(),
      userId:       userId.toString(),
      companyId:    user.companyId.toString(),
      token,
      boardIds,
      boardNameMap,
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
