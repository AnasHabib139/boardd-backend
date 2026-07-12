"use strict";

const { createChannel, updateChannel, findChannel }                         = require("../models/channelModel");
const { createChannelTab, findChannelTab }                                  = require("../models/channelTabsModel");
const { createChatConversation }                                            = require("../models/chatConversationModel");
const { findUserIntegration, updateUserIntegration, deleteUserIntegration } = require("../models/userIntegrationModel");
const { findUser }                                                          = require("../models/userModel");
const github                                                                = require("../services/githubService");
const { generateResponse }                                                  = require("../utils");
const { STATUS_CODES }                                                      = require("../utils/constants");
const { generateJoinToken }                                                 = require("./helpers/users/signup.helper");
const { getGithubImportQueue }                                              = require("../jobs/githubImportQueue");
const { createImportJob, findImportJob }                                    = require("../models/importJobModel");

// ─── Handlers ────────────────────────────────────────────────────────────────

exports.getAuthUrl = async (req, res, next) => {
  try {
    return generateResponse({ authUrl: github.getAuthUrl() }, "GitHub auth URL", res);
  } catch (error) {
    return next(error);
  }
};

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

    // Resolve channel + tab (same pattern as Jira/Notion/Linear)
    let channel, tab;
    if (channelId) {
      channel = await findChannel({ _id: channelId, companyId: user.companyId });
      if (!channel) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
      if (!tab) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task management tab not found in this channel" });
    } else {
      const resolvedName = channelName || "GitHub Import";
      channel = await createChannel({
        channelName:        resolvedName,
        channelDescription: "Imported from GitHub",
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

    const job = await createImportJob({ userId, platform: "github", status: "pending" });
    await getGithubImportQueue().add("import", {
      jobId:        job._id.toString(),
      userId:       userId.toString(),
      companyId:    user.companyId.toString(),
      token:        integration.accessToken,
      importType,
      repoIds:        repoIds || null,
      repoInfoMap,
      projectIds:     projectIds || null,
      projectInfoMap,
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

exports.disconnectGithub = async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform: "github" });
    return generateResponse({}, "GitHub disconnected", res);
  } catch (error) {
    return next(error);
  }
};
