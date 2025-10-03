"use strict";

const { getRedis } = require("../utils/redis");

/**
 * Blacklist a specific token (for current device logout or specific device termination)
 * @param {string} tokenOrJti - JWT access token or JTI
 * @param {number} expiresInSeconds - Token TTL for auto-cleanup (default: 600s = 10 min)
 * @returns {Promise<boolean>}
 */
exports.blacklistToken = async (tokenOrJti, expiresInSeconds = 600) => {
  try {
    const redis = getRedis();
    const key = `blacklist:token:${tokenOrJti}`;

    // Store in Redis with TTL (auto-expires when token would expire)
    await redis.setex(key, expiresInSeconds, "revoked");

    console.log(`🚫 Token blacklisted (expires in ${expiresInSeconds}s)`);
    return true;
  } catch (error) {
    console.error("❌ Failed to blacklist token:", error.message);
    return false;
  }
};

/**
 * Blacklist all active tokens for a user by setting a timestamp
 * Any token issued before this timestamp will be rejected
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
exports.blacklistUserTokens = async (userId) => {
  try {
    const redis = getRedis();
    const key = `user:blacklist:${userId}`;
    const timestamp = Date.now(); // Current timestamp in milliseconds

    // Store user blacklist timestamp (no TTL - permanent until cleared)
    await redis.set(key, timestamp);

    console.log(`🚫 Blacklisted all tokens for user ${userId} (timestamp: ${timestamp})`);
    return true;
  } catch (error) {
    console.error("❌ Failed to blacklist user tokens:", error.message);
    return false;
  }
};

/**
 * Check if a token is blacklisted
 * Checks both specific token blacklist AND user-level blacklist
 * @param {string} fullToken - Full JWT access token
 * @param {string} jti - JWT ID from token payload
 * @param {string} userId - User ID
 * @param {number} tokenIssuedAt - JWT 'iat' claim (issued at timestamp in seconds)
 * @returns {Promise<boolean>}
 */
exports.isTokenBlacklisted = async (fullToken, jti, userId, tokenIssuedAt) => {
  try {
    const redis = getRedis();

    // Check 1a: Is the full token blacklisted? (for logout current device)
    const fullTokenKey = `blacklist:token:${fullToken}`;
    const fullTokenBlacklist = await redis.get(fullTokenKey);

    if (fullTokenBlacklist === "revoked") {
      console.log(`🚫 Token rejected: Full token is blacklisted`);
      return true;
    }

    // Check 1b: Is the JTI blacklisted? (for revoke specific device)
    if (jti) {
      const jtiKey = `blacklist:token:${jti}`;
      const jtiBlacklist = await redis.get(jtiKey);

      if (jtiBlacklist === "revoked") {
        console.log(`🚫 Token rejected: JTI is blacklisted`);
        return true;
      }
    }

    // Check 2: Is user blacklisted AND token issued before blacklist timestamp?
    const userBlacklistKey = `user:blacklist:${userId}`;
    const userBlacklistTime = await redis.get(userBlacklistKey);

    if (userBlacklistTime) {
      const blacklistTimestamp = parseInt(userBlacklistTime);
      const tokenTimestamp = tokenIssuedAt * 1000; // Convert iat (seconds) to milliseconds

      if (tokenTimestamp < blacklistTimestamp) {
        console.log(
          `🚫 Token rejected: Issued before user blacklist (token: ${new Date(
            tokenTimestamp
          ).toISOString()}, blacklist: ${new Date(blacklistTimestamp).toISOString()})`
        );
        return true;
      }
    }

    // Token is valid
    return false;
  } catch (error) {
    console.error("❌ Failed to check token blacklist:", error.message);
    // Fail-safe: if Redis is down, allow request (don't break app)
    // You can change this to 'return true' for stricter security
    return false;
  }
};

/**
 * Clear user-level blacklist (useful for testing or admin operations)
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
exports.clearUserBlacklist = async (userId) => {
  try {
    const redis = getRedis();
    const key = `user:blacklist:${userId}`;
    await redis.del(key);

    console.log(`✅ Cleared user blacklist for ${userId}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to clear user blacklist:", error.message);
    return false;
  }
};
