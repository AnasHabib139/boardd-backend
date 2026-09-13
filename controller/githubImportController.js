"use strict";

const { findUserIntegration, updateUserIntegration }                       = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const github                                                                = require("../services/githubService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { getGithubImportQueue }                                              = require("../jobs/githubImportQueue");
const { resolveImportChannel } = require("./helpers/imports/channelResolution.helper");
const { createAndEnqueueImportJob } = require("./helpers/imports/importJob.helper");
const { makeGetAuthUrlHandler } = require("./helpers/imports/authUrl.helper");
const { makeDisconnectHandler } = require("./helpers/imports/disconnectIntegration.helper");

// ─── Handlers ────────────────────────────────────────────────────────────────

exports.getAuthUrl = makeGetAuthUrlHandler(github, "GitHub");

exports.connectGithub = async (req, res, next) => {
  try {
    const { code } = req.body;
    const userId   = req.user.id;

    const tokenResponse = await github.exchangeCode(code);
    const { access_token } = tokenResponse;

    let me = null;
    try { me = await github.getMe(access_token); } catch (_) {}

    await updateUserIntegration(
      { userId, platform: "github" },
      {
        accessToken:      access_token,
        platformUserId:   me?.id   ? String(me.id) : "",
        platformUserName: me?.name || me?.login || "",
        isActive:         true,
      },
      { upsert: true }
    );

    return generateResponse(
      { username: me?.login || "GitHub Account" },
      "GitHub connected successfully",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getGithubRepos = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "github", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "GitHub not connected" });

    const repos = await github.listRepos(integration.accessToken);

    return generateResponse(
      repos.map((r) => ({ id: r.id, fullName: r.fullName, name: r.name, private: r.private })),
      "Repositories fetched",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.getGithubProjects = async (req, res, next) => {
  try {
    const integration = await findUserIntegration({ userId: req.user.id, platform: "github", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "GitHub not connected" });

    let projects;
    try {
      projects = await github.listProjects(integration.accessToken);
    } catch (err) {
      console.error("[GitHub Projects] listProjects failed:", err.message || err);
      return next({
        statusCode: STATUS_CODES.UNPROCESSABLE_ENTITY,
        message: "Could not fetch GitHub Projects — reconnect your GitHub account to grant Projects access (this integration was connected before Projects support was added).",
      });
    }

    return generateResponse(
      projects.map((p) => ({ id: p.id, title: p.title, number: p.number, ownerLogin: p.ownerLogin })),
      "Projects fetched",
      res
    );
  } catch (error) {
    return next(error);
  }
};

exports.importGithubRepos = async (req, res, next) => {
  try {
    const { importType, repoIds, projectIds, channelId, channelName } = req.body;
    const userId = req.user.id;
    const user   = await findUser({ _id: userId });

    const integration = await findUserIntegration({ userId, platform: "github", isActive: true });
    if (!integration) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "GitHub not connected" });

    let repoInfoMap    = null;
    let projectInfoMap = null;

    if (importType === "issues") {
      const allRepos = await github.listRepos(integration.accessToken);
      repoInfoMap = {};
      for (const r of allRepos) {
        repoInfoMap[String(r.id)] = { fullName: r.fullName, name: r.name };
      }
    } else {
      let allProjects;
      try {
        allProjects = await github.listProjects(integration.accessToken);
      } catch (err) {
        console.error("[GitHub Projects] listProjects failed during import:", err.message || err);
        return next({
          statusCode: STATUS_CODES.UNPROCESSABLE_ENTITY,
          message: "Could not fetch GitHub Projects — reconnect your GitHub account to grant Projects access.",
        });
      }
      projectInfoMap = {};
      for (const p of allProjects) {
        projectInfoMap[p.id] = { title: p.title, number: p.number, ownerLogin: p.ownerLogin };
      }
    }

    const { channel, tab, isNewChannel } = await resolveImportChannel({
      channelId,
      channelName,
      userId,
      companyId: user.companyId,
      platform: "GitHub",
      defaultName: "GitHub Import",
    });

    const { jobId } = await createAndEnqueueImportJob({
      platform: "github",
      queue: getGithubImportQueue(),
      userId,
      companyId: user.companyId,
      payload: {
        token: integration.accessToken,
        importType,
        repoIds: repoIds || null,
        repoInfoMap,
        projectIds: projectIds || null,
        projectInfoMap,
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

exports.disconnectGithub = makeDisconnectHandler("github", "GitHub");
