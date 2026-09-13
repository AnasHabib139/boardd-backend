"use strict";

const { generateResponse } = require("../../../utils");
const { deleteUserIntegration } = require("../../../models/userIntegrationModel");

exports.makeDisconnectHandler = (platform, label) => async (req, res, next) => {
  try {
    await deleteUserIntegration({ userId: req.user.id, platform });
    return generateResponse({}, `${label} disconnected`, res);
  } catch (error) {
    return next(error);
  }
};
