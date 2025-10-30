"use strict";

const config = require("../config");
const { STATUS_CODES } = require("../../utils/constants");

/**
 * Service-to-service authentication middleware
 * Validates internal requests from main backend
 *
 * For now: Simple shared secret
 * Future: Upgrade to JWT or mTLS
 */
function validateServiceRequest(req, res, next) {
  try {
    // Check for service key in header
    const serviceKey = req.headers["x-service-key"];

    if (!serviceKey) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        error: "Service authentication required",
        message: "Missing X-Service-Key header",
      });
    }

    // Validate service key
    if (serviceKey !== config.service.internalServiceKey) {
      return res.status(STATUS_CODES.UNAUTHORIZED).json({
        error: "Invalid service credentials",
        message: "Service key validation failed",
      });
    }

    // Service authenticated successfully
    next();
  } catch (error) {
    console.error("Service auth error:", error);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      error: "Service authentication error",
      message: error.message,
    });
  }
}

/**
 * Optional service auth
 * Allows both authenticated service calls and regular user auth
 */
function optionalServiceAuth(req, res, next) {
  const serviceKey = req.headers["x-service-key"];

  if (serviceKey) {
    // If service key present, validate it
    return validateServiceRequest(req, res, next);
  }

  // Otherwise, continue (will be handled by regular Auth middleware)
  next();
}

module.exports = {
  validateServiceRequest,
  optionalServiceAuth,
};
