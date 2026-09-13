"use strict";

const { findUserIntegration, updateUserIntegration } = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const monday                                                                = require("../services/mondayService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { getMondayImportQueue }                                              = require("../jobs/mondayImportQueue");
const { resolveImportChannel } = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler } = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler } = require("./helpers/imports/disconnectIntegration.helper");

exports.getAuthUrl = makeGetAuthUrlHandler(monday, "Monday");

exports.connectMonday = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const tokenResponse = await monday.exchangeCode(code);
    const { access_token } = tokenResponse;
    // Monday doesn't include user info in token response — fetch separately, non-fatal
    let meUser = null;
    try { meUser = await monday.getMe(access_token); } catch (e) {
      console.warn("[Monday] getMe failed (scope issue?):", e.message);
    }

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

exports.disconnectMonday = makeDisconnectHandler("monday", "Monday");

exports.importMondayBoards = async (req, res, next) => {
  try {
    const { boardIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "monday", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Monday not connected" });
    const token = integration.accessToken;

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "Monday.com",
      defaultName: "Monday Import",
    });

    // Build boardNameMap for progress display
    const allBoards    = await monday.getBoards(token);
    const boardNameMap = {};
    for (const b of allBoards) boardNameMap[b.id] = b.name;

    // Create job and enqueue
    const { jobId } = await createAndEnqueueImportJob({
      platform: "monday",
      queue: getMondayImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token,
        boardIds,
        boardNameMap,
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
