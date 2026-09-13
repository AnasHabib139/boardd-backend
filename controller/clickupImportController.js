"use strict";

const { findUserIntegration, updateUserIntegration } = require("../models/userIntegrationModel");
const { findUser } = require("../models/userModel");
const clickup = require("../services/clickupService");
const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { getImportQueue } = require("../jobs/clickupImportQueue");
const { resolveImportChannel } = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler } = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler } = require("./helpers/imports/disconnectIntegration.helper");

// ─── Controllers ────────────────────────────────────────────────────────────

exports.getAuthUrl = makeGetAuthUrlHandler(clickup, "ClickUp");

exports.connectClickUp = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    const { access_token } = await clickup.exchangeCode(code);
    const cuUser = await clickup.getAuthorizedUser(access_token);

    await updateUserIntegration(
      { userId, platform: "clickup" },
      { accessToken: access_token, platformUserId: String(cuUser.user?.id || ""), platformUserName: cuUser.user?.username || "", isActive: true },
      { upsert: true }
    );

    return generateResponse(
      { username: cuUser.user?.username, email: cuUser.user?.email },
      "ClickUp connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getClickUpSpaces = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "clickup", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "ClickUp not connected" });
    }

    const workspaces = await clickup.getWorkspaces(integration.accessToken);
    const spaces = [];
    for (const workspace of workspaces) {
      const workspaceSpaces = await clickup.getSpaces(integration.accessToken, workspace.id);
      for (const space of workspaceSpaces) {
        spaces.push({ id: space.id, name: space.name, workspaceId: workspace.id, workspaceName: workspace.name });
      }
    }

    return generateResponse(spaces, "Spaces fetched", res);
  } catch (error) {
    return next(error);
  }
};

exports.disconnectClickUp = makeDisconnectHandler("clickup", "ClickUp");

exports.importClickUpSpaces = async (req, res, next) => {
  try {
    const { spaceIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "clickup", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "ClickUp not connected" });
    }
    const token = integration.accessToken;

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "ClickUp",
      defaultName: "ClickUp Import",
    });

    // Fetch space names for progress display
    const workspaces = await clickup.getWorkspaces(token);
    const spaceNameMap = {};
    for (const workspace of workspaces) {
      const spaces = await clickup.getSpaces(token, workspace.id);
      for (const space of spaces) spaceNameMap[space.id] = space.name;
    }

    // Create job record and enqueue — worker runs in background
    const { jobId } = await createAndEnqueueImportJob({
      platform: "clickup",
      queue: getImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token,
        spaceIds,
        spaceNameMap,
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
