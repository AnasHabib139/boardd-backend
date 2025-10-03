"use strict";

const { STATUS_CODES } = require("../utils/constants");
const { generateResponse } = require("../utils");
const {
  COOKIE_CONFIG,
  shouldSlideToken,
  calculateSlidingExpiry,
} = require("../utils/tokenConstants");
const { findByRefreshToken, UPDATE_QUERIES } = require("../utils/tokenQueries");
const {
  findUser,
  generateToken,
  updateUser,
  getActiveRefreshTokens,
} = require("../models/userModel");

// POST /auth/refresh-token
exports.refreshToken = async (req, res, next) => {
  try {
    // Get refresh token from httpOnly cookie
    const refreshToken = req.cookies[COOKIE_CONFIG.REFRESH_TOKEN_NAME];

    if (!refreshToken) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Refresh token not found",
      });
    }

    // Find user by refresh token using tokenQueries helper
    const user = await findUser(findByRefreshToken(refreshToken)).select(
      "+refreshTokens"
    );
    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Invalid or expired refresh token",
      });
    }

    // Find the specific refresh token in user's array
    const tokenData = user.refreshTokens.find(
      (token) => token.token === refreshToken && token.isActive
    );

    if (!tokenData) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Refresh token not found or inactive",
      });
    }

    // Generate new access token with new JTI
    const { token: accessToken, jti } = generateToken(user);

    // Check if token should slide (has 15+ days remaining)
    if (shouldSlideToken(tokenData)) {
      const newExpiresAt = calculateSlidingExpiry();
      await updateUser(
        { _id: user._id, "refreshTokens.token": refreshToken },
        {
          ...UPDATE_QUERIES.updateExpiration(newExpiresAt),
          $set: {
            ...UPDATE_QUERIES.updateExpiration(newExpiresAt).$set,
            "refreshTokens.$.currentAccessTokenJti": jti, // Update JTI
          },
        }
      );
      console.log(`🔄 Token sliding: Extended expiry to ${newExpiresAt}`);
    } else {
      // Just update lastUsedAt and JTI if not sliding
      await updateUser(
        { _id: user._id, "refreshTokens.token": refreshToken },
        {
          $set: {
            "refreshTokens.$.lastUsedAt": new Date(),
            "refreshTokens.$.currentAccessTokenJti": jti, // Update JTI
          },
        }
      );
    }

    // Update user's last active time (using lastLoginAt field)
    // This happens every 15 minutes when refresh token is used
    await updateUser(
      { _id: user._id },
      { lastLoginAt: new Date() }
    );

    return generateResponse(
      { accessToken },
      "Access token refreshed successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// POST /auth/logout
exports.logout = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get refresh token from cookie
    const refreshToken = req.cookies[COOKIE_CONFIG.REFRESH_TOKEN_NAME];

    if (!refreshToken) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "No refresh token found",
      });
    }

    // Blacklist the current access token (immediate termination)
    const accessToken = req.header("accessToken") || req.session.accessToken;
    if (accessToken) {
      const { blacklistToken } = require("../services/tokenBlacklist");
      await blacklistToken(accessToken, 600); // 10 min TTL
      console.log("🚫 Access token blacklisted on logout");
    }

    // Remove the specific refresh token using tokenQueries helper
    await updateUser({ _id: userId }, UPDATE_QUERIES.removeToken(refreshToken));

    // Clear the httpOnly cookie
    const clearOptions = {
      httpOnly: COOKIE_CONFIG.HTTP_ONLY,
      secure: COOKIE_CONFIG.SECURE,
      sameSite: COOKIE_CONFIG.SAME_SITE,
    };

    // Add domain if specified (for cross-domain support)
    if (COOKIE_CONFIG.DOMAIN) {
      clearOptions.domain = COOKIE_CONFIG.DOMAIN;
    }

    res.clearCookie(COOKIE_CONFIG.REFRESH_TOKEN_NAME, clearOptions);

    return generateResponse(
      null,
      "Logged out successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// POST /auth/logout-all-devices
exports.logoutAllDevices = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Blacklist user-level timestamp (all old tokens invalidated)
    const { blacklistUserTokens } = require("../services/tokenBlacklist");
    await blacklistUserTokens(userId);
    console.log(`🚫 User-level blacklist set for ${userId}`);

    // Remove all refresh tokens using tokenQueries helper
    await updateUser({ _id: userId }, UPDATE_QUERIES.removeAllTokens());

    // Clear the httpOnly cookie
    const clearOptions = {
      httpOnly: COOKIE_CONFIG.HTTP_ONLY,
      secure: COOKIE_CONFIG.SECURE,
      sameSite: COOKIE_CONFIG.SAME_SITE,
    };

    // Add domain if specified (for cross-domain support)
    if (COOKIE_CONFIG.DOMAIN) {
      clearOptions.domain = COOKIE_CONFIG.DOMAIN;
    }

    res.clearCookie(COOKIE_CONFIG.REFRESH_TOKEN_NAME, clearOptions);

    return generateResponse(
      null,
      "Logged out from all devices successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// GET /auth/active-sessions
exports.getActiveSessions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const currentRefreshToken = req.cookies[COOKIE_CONFIG.REFRESH_TOKEN_NAME];

    // Update current device's location AND lastUsedAt before fetching sessions
    if (currentRefreshToken) {
      try {
        const { extractDeviceInfo } = require("../utils/deviceDetection");
        const currentDeviceInfo = await extractDeviceInfo(req);

        // Build update object
        const updateFields = {
          "refreshTokens.$.lastUsedAt": new Date(), // Always update lastUsedAt
        };

        // Add location if successfully detected
        if (currentDeviceInfo.location) {
          updateFields["refreshTokens.$.deviceInfo.location"] = currentDeviceInfo.location;
          console.log(
            `🌍 Updated current session location:`,
            currentDeviceInfo.location
          );
        }

        // Update both location and lastUsedAt in single query
        await updateUser(
          { _id: userId, "refreshTokens.token": currentRefreshToken },
          { $set: updateFields }
        );

        console.log(`⏰ Updated lastUsedAt to: ${new Date().toISOString()}`);
      } catch (locationError) {
        // Non-critical error - continue even if location update fails
        console.warn("Failed to update session info:", locationError.message);
      }
    }

    // Get all active refresh tokens for the user (this one stays as it has complex filtering logic)
    const activeTokens = await getActiveRefreshTokens(userId);

    // Format the response with device info, timestamps, and activity status
    const sessions = activeTokens.map((token) => {
      const minutesSinceLastUse = Math.floor(
        (Date.now() - new Date(token.lastUsedAt)) / (1000 * 60)
      );

      // Determine activity status
      let activityStatus;
      if (minutesSinceLastUse <= 15) {
        activityStatus = "active"; // Green - currently active (within 15 min)
      } else if (minutesSinceLastUse <= 60) {
        activityStatus = "recent"; // Orange - recently active (within 1 hour)
      } else {
        activityStatus = "idle"; // Gray - inactive (over 1 hour)
      }

      return {
        id: token._id,
        deviceInfo: {
          browser: token.deviceInfo.browser,
          os: token.deviceInfo.os,
          deviceType: token.deviceInfo.deviceType,
          location: token.deviceInfo.location || null,
        },
        createdAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
        expiresAt: token.expiresAt,
        isCurrentSession: currentRefreshToken === token.token,
        // Activity tracking
        minutesSinceLastUse,
        isRecentlyActive: minutesSinceLastUse <= 60, // Within 1 hour
        activityStatus, // "active" | "recent" | "idle"
      };
    });

    return generateResponse(
      { sessions, totalSessions: sessions.length },
      "Active sessions retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// DELETE /auth/revoke-session/:tokenId
exports.revokeSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { tokenId } = req.params;

    if (!tokenId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Token ID is required",
      });
    }

    // Get user with refresh tokens
    const user = await findUser({ _id: userId }).select("+refreshTokens");
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find the token to revoke
    const tokenToRevoke = user.refreshTokens.find(
      (token) => token._id.toString() === tokenId
    );

    if (!tokenToRevoke) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Session not found",
      });
    }

    // Blacklist the device's current access token JTI (immediate termination)
    if (tokenToRevoke.currentAccessTokenJti) {
      const { blacklistToken } = require("../services/tokenBlacklist");
      await blacklistToken(tokenToRevoke.currentAccessTokenJti, 600); // 10 min TTL
      console.log(`🚫 Device JTI blacklisted: ${tokenToRevoke.currentAccessTokenJti}`);
    }

    // Remove the specific token using tokenQueries helper
    await updateUser(
      { _id: userId },
      UPDATE_QUERIES.removeToken(tokenToRevoke.token)
    );

    // If revoking current session, clear cookie
    const currentRefreshToken = req.cookies[COOKIE_CONFIG.REFRESH_TOKEN_NAME];
    if (currentRefreshToken === tokenToRevoke.token) {
      const clearOptions = {
        httpOnly: COOKIE_CONFIG.HTTP_ONLY,
        secure: COOKIE_CONFIG.SECURE,
        sameSite: COOKIE_CONFIG.SAME_SITE,
      };

      // Add domain if specified (for cross-domain support)
      if (COOKIE_CONFIG.DOMAIN) {
        clearOptions.domain = COOKIE_CONFIG.DOMAIN;
      }

      res.clearCookie(COOKIE_CONFIG.REFRESH_TOKEN_NAME, clearOptions);
    }

    return generateResponse(
      null,
      "Session revoked successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
