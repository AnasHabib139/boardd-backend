"use strict";

const { verify } = require("jsonwebtoken");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findCompany } = require("../models/companyModel");
const { isTokenBlacklisted } = require("../services/tokenBlacklist");

module.exports = (roles) => {
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

      req.user = { ...decoded };

      try {
        const user = await findUser({ _id: req.user.id });

        if (!user) {
          return next({
            statusCode: STATUS_CODES.UNAUTHORIZED,
            message: "Invalid token!",
          });
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

        if (!user.isActive) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "Your profile is inactive, please contact admin",
          });
        }

        const company = await findCompany({ _id: user.companyId });

        if (!company || !company.isActive) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "Your company account has been disabled, please contact support",
          });
        }

        // Check if account has expired (for guest accounts)
        if (user.expiresAt && new Date() > user.expiresAt) {
          return next({
            statusCode: STATUS_CODES.UNAUTHORIZED,
            message:
              "Your account has expired. Please contact support for renewal.",
          });
        }

        if (roles.includes(req.user.role)) {
          next();
        } else {
          return next({
            statusCode: STATUS_CODES.UNAUTHORIZED,
            message: "Unauthorized access!",
          });
        }
      } catch (error) {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Invalid token!",
        });
      }
    });
  };
};
