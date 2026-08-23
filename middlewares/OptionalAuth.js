"use strict";

const { verify } = require("jsonwebtoken");
const { findUser } = require("../models/userModel");
const { findCompany } = require("../models/companyModel");
const { isTokenBlacklisted } = require("../services/tokenBlacklist");

/**
 * Optional Authentication Middleware
 * Allows both authenticated and guest access
 * Sets req.user if valid token is provided, otherwise continues without user
 */
module.exports = (roles = []) => {
  return async (req, res, next) => {
    const accessToken = req.header("accessToken") || req.session.accessToken;

    // If no token provided, continue as guest
    if (!accessToken) {
      req.user = null;
      return next();
    }

    try {
      // Verify token
      const decoded = verify(accessToken, process.env.JWT_SECRET);

      // Find user
      const user = await findUser({ _id: decoded.id });
      if (!user) {
        req.user = null;
        return next();
      }

      // Check if user is active
      if (!user.isActive) {
        req.user = null;
        return next();
      }

      // Check if token is blacklisted (specific token, user-level, or company-level)
      try {
        const blacklisted = await isTokenBlacklisted(
          accessToken,      // Full token (for logout current device)
          decoded.jti,      // JTI (for revoke specific device)
          decoded.id,       // User ID
          decoded.iat,      // Token issued at
          user.companyId    // Company ID
        );

        if (blacklisted) {
          req.user = null;
          return next();
        }
      } catch (redisError) {
        // Log error but continue (fail-open for availability)
        console.error("Redis blacklist check failed:", redisError.message);
      }

      // Check if the user's company has been disabled
      const company = await findCompany({ _id: user.companyId })
        .select("isActive")
        .lean();

      if (!company || !company.isActive) {
        req.user = null;
        return next();
      }

      // Set user in request
      req.user = { ...decoded };

      // If roles are specified and user doesn't have required role, treat as guest
      if (roles.length > 0 && !roles.includes(req.user.role)) {
        req.user = null;
        return next();
      }

      next();
    } catch (err) {
      // Invalid token, continue as guest
      req.user = null;
      next();
    }
  };
};
