"use strict";

const { findManyUserIntegrations } = require("../models/userIntegrationModel");
const { generateResponse } = require("../utils");

const PLATFORMS = ["trello", "clickup", "asana", "monday", "jira", "notion", "linear", "github"];

exports.getIntegrationsStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const integrations = await findManyUserIntegrations({ userId, platform: { $in: PLATFORMS }, isActive: true });

    const byPlatform = {};
    for (const platform of PLATFORMS) {
      byPlatform[platform] = { connected: false };
    }
    for (const integration of integrations) {
      const entry = {
        connected: true,
        username:  integration.platformUserName || null,
      };
      if (integration.platform === "jira") {
        entry.siteSelected = !!integration.cloudId;
        entry.siteName     = integration.cloudName || null;
      }
      byPlatform[integration.platform] = entry;
    }

    return generateResponse(byPlatform, "Integrations status", res);
  } catch (error) {
    return next(error);
  }
};
