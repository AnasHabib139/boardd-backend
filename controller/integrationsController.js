"use strict";

const { findManyUserIntegrations } = require("../models/userIntegrationModel");
const { generateResponse } = require("../utils");

const PLATFORMS = ["trello", "clickup", "asana", "monday", "jira"];

exports.getIntegrationsStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const integrations = await findManyUserIntegrations({ userId, platform: { $in: PLATFORMS }, isActive: true });

    const byPlatform = {};
    for (const platform of PLATFORMS) {
      byPlatform[platform] = { connected: false };
    }
    for (const integration of integrations) {
      byPlatform[integration.platform] = {
        connected: true,
        username: integration.platformUserName || null,
      };
    }

    return generateResponse(byPlatform, "Integrations status", res);
  } catch (error) {
    return next(error);
  }
};
