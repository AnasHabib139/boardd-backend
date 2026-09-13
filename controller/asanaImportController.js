"use strict";

const { findUserIntegration, updateUserIntegration }                       = require("../models/userIntegrationModel");
const { findUser }                                                         = require("../models/userModel");
const asana                                                                = require("../services/asanaService");
const { generateResponse }                                                 = require("../utils");
const { STATUS_CODES }                                                     = require("../utils/constants");
const { getAsanaImportQueue }                                              = require("../jobs/asanaImportQueue");
const { resolveImportChannel }     = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler }     = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler }     = require("./helpers/imports/disconnectIntegration.helper");

// ─── Controllers ──────────────────────────────────────────────────────────────

exports.getAuthUrl = makeGetAuthUrlHandler(asana, "Asana");

exports.connectAsana = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const tokenResponse = await asana.exchangeCode(code);
    const { access_token } = tokenResponse;
    const asanaUser = tokenResponse.data; // { id, name, email } — lives in .data, not .user

    await updateUserIntegration(
      { userId, platform: "asana" },
      {
        accessToken:      access_token,
        platformUserId:   String(asanaUser?.id || ""),
        platformUserName: asanaUser?.name || "",
        isActive:         true,
      },
      { upsert: true }
    );

    return generateResponse(
      { username: asanaUser?.name, email: asanaUser?.email },
      "Asana connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getAsanaProjects = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "asana", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Asana not connected" });
    }

    const workspaces = await asana.getWorkspaces(integration.accessToken);
    const projects   = [];
    for (const ws of workspaces) {
      const wsProjects = await asana.getProjects(integration.accessToken, ws.gid);
      for (const p of wsProjects) {
        projects.push({ id: p.gid, name: p.name, workspaceId: ws.gid, workspaceName: ws.name });
      }
    }

    return generateResponse(projects, "Projects fetched", res);
  } catch (error) {
    return next(error);
  }
};

exports.disconnectAsana = makeDisconnectHandler("asana", "Asana");

exports.importAsanaProjects = async (req, res, next) => {
  try {
    const { projectIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "asana", isActive: true });
    if (!integration) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Asana not connected" });
    }
    const token = integration.accessToken;

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "Asana",
      defaultName: "Asana Import",
    });

    // ── Build projectNameMap for progress display ──────────────────────────────
    const workspaces     = await asana.getWorkspaces(token);
    const projectNameMap = {};
    for (const ws of workspaces) {
      const projects = await asana.getProjects(token, ws.gid);
      for (const p of projects) projectNameMap[p.gid] = p.name;
    }

    // ── Create job record & enqueue ───────────────────────────────────────────
    const { jobId } = await createAndEnqueueImportJob({
      platform: "asana",
      queue: getAsanaImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token,
        projectIds,
        projectNameMap,
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
