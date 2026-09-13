"use strict";

const { generateResponse } = require("../../../utils");

exports.makeGetAuthUrlHandler = (service, label) => async (req, res, next) => {
  try {
    return generateResponse({ authUrl: service.getAuthUrl() }, `${label} auth URL`, res);
  } catch (error) {
    return next(error);
  }
};
