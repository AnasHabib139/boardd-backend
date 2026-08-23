"use strict";

const { verify } = require("jsonwebtoken");
const { STATUS_CODES } = require("../utils/constants");
const { findSuperAdmin } = require("../models/superAdminModel");
const { isTokenBlacklisted } = require("../services/tokenBlacklist");

module.exports = () => {
  return async (req, res, next) => {
    const accessToken = req.header("accessToken") || req.session.accessToken;
    if (!accessToken) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Authorization failed!",
      });
    }

    verify(accessToken, process.env.JWT_SECRET, async function (err, decoded) {
      if (err) {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Invalid token!",
        });
      }

      if (decoded.type !== "super_admin") {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Invalid token!",
        });
      }

      // Check if token is blacklisted (specific token or user-level)
      try {
        const blacklisted = await isTokenBlacklisted(
          accessToken,    // Full token (for logout current device)
          decoded.jti,    // JTI (for revoke specific device)
          decoded.id,     // User ID
          decoded.iat,    // Token issued at
          null            // Super admins aren't scoped to a company
        );

        if (blacklisted) {
          return next({
            statusCode: STATUS_CODES.UNAUTHORIZED,
            message: "Token has been revoked. Please log in again.",
          });
        }
      } catch (redisError) {
        // Log error but continue (fail-open for availability)
        console.error("Redis blacklist check failed:", redisError.message);
        // You can change this to fail-closed by returning error here
      }

      try {
        const superAdmin = await findSuperAdmin({ _id: decoded.id });

        if (!superAdmin) {
          return next({
            statusCode: STATUS_CODES.UNAUTHORIZED,
            message: "Invalid token!",
          });
        }

        if (!superAdmin.isActive) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "Your profile is inactive, please contact admin",
          });
        }

        req.superAdmin = { ...decoded };

        next();
      } catch (error) {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Invalid token!",
        });
      }
    });
  };
};
