"use strict";

const { findUserIntegration, updateUserIntegration } = require("../models/userIntegrationModel");
const { findUser } = require("../models/userModel");
const trello = require("../services/trelloService");
const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { getTrelloImportQueue } = require("../jobs/trelloImportQueue");
const { resolveImportChannel } = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler } = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler } = require("./helpers/imports/disconnectIntegration.helper");

// ─── Controllers ────────────────────────────────────────────────────────────

exports.getAuthUrl = makeGetAuthUrlHandler(trello, "Trello");

exports.connectTrello = async (req, res, next) => {
  try {
    const { token } = req.body;
    const userId = req.user.id;

    const member = await trello.validateToken(token);

    await updateUserIntegration(
      { userId, platform: "trello" },
      { accessToken: token, platformUserId: member.id, platformUserName: member.username, isActive: true },
      { upsert: true }
    );

    return generateResponse(
      { username: member.username, fullName: member.fullName },
      "Trello connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getTrelloBoards = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "trello", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Trello not connected" });
    }

    const boards = await trello.getMemberBoards(integration.accessToken);
    return generateResponse(
      boards.map((b) => ({ id: b.id, name: b.name, desc: b.desc })),
      "Boards fetched",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.disconnectTrello = makeDisconnectHandler("trello", "Trello");

exports.importTrelloBoard = async (req, res, next) => {
  try {
    const { boardIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "trello", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Trello not connected" });
    }
    const token = integration.accessToken;

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "Trello",
      defaultName: "Trello Import",
    });

    const { jobId } = await createAndEnqueueImportJob({
      platform: "trello",
      queue: getTrelloImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token,
        boardIds,
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
