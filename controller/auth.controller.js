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

    // Check if token should slide (has 15+ days remaining)
    if (shouldSlideToken(tokenData)) {
      const newExpiresAt = calculateSlidingExpiry();
      await updateUser(
        { _id: user._id, "refreshTokens.token": refreshToken },
        UPDATE_QUERIES.updateExpiration(newExpiresAt)
      );
      console.log(`🔄 Token sliding: Extended expiry to ${newExpiresAt}`);
    } else {
      // Just update lastUsedAt if not sliding
      await updateUser(
        { _id: user._id, "refreshTokens.token": refreshToken },
        UPDATE_QUERIES.updateLastUsed()
      );
    }

    // Update user's last active time (using lastLoginAt field)
    // This happens every 15 minutes when refresh token is used
    await updateUser(
      { _id: user._id },
      { lastLoginAt: new Date() }
    );

    // Generate new access token
    const accessToken = generateToken(user);

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

    // Get all active refresh tokens for the user (this one stays as it has complex filtering logic)
    const activeTokens = await getActiveRefreshTokens(userId);

    // Format the response with device info and timestamps
    const sessions = activeTokens.map((token) => ({
      id: token._id,
      deviceInfo: {
        browser: token.deviceInfo.browser,
        os: token.deviceInfo.os,
        deviceType: token.deviceInfo.deviceType,
      },
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
      isCurrentSession:
        req.cookies[COOKIE_CONFIG.REFRESH_TOKEN_NAME] === token.token,
    }));

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
