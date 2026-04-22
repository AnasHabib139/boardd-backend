"use strict";

const Redis = require("ioredis");

let redisClient = null;

/**
 * Initialize Redis connection
 * @returns {Redis} Redis client instance
 */
const initRedis = () => {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  redisClient.on("connect", () => {
    console.log("✅ Redis connected successfully");
  });

  redisClient.on("error", (err) => {
    console.error("❌ Redis connection error:", err.message);
  });

  redisClient.on("ready", () => {
    console.log("🚀 Redis is ready to accept connections");
  });

  return redisClient;
};

/**
 * Get Redis client instance
 * @returns {Redis} Redis client instance
 */
const getRedis = () => {
  if (!redisClient) {
    return initRedis();
  }
  return redisClient;
};

/**
 * Close Redis connection (for graceful shutdown)
 */
const closeRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log("👋 Redis connection closed");
  }
};

/**
 * Add a socket ID to a user's presence set
 * Returns the new socket count for that user
 */
const addUserSocket = async (userId, socketId) => {
  const redis = getRedis();
  await redis.sadd(`user:presence:${userId}`, socketId);
  return redis.scard(`user:presence:${userId}`);
};

/**
 * Remove a socket ID from a user's presence set
 * Returns the remaining socket count for that user
 */
const removeUserSocket = async (userId, socketId) => {
  const redis = getRedis();
  await redis.srem(`user:presence:${userId}`, socketId);
  return redis.scard(`user:presence:${userId}`);
};

/**
 * Bulk check online status for multiple users
 * Returns a map of { userId: boolean }
 */
const getOnlineStatuses = async (userIds) => {
  if (!userIds.length) return {};
  const redis = getRedis();
  const pipeline = redis.pipeline();
  userIds.forEach((id) => pipeline.scard(`user:presence:${id}`));
  const results = await pipeline.exec();
  const map = {};
  userIds.forEach((id, i) => {
    map[id] = (results[i][1] || 0) > 0;
  });
  return map;
};

module.exports = { initRedis, getRedis, closeRedis, addUserSocket, removeUserSocket, getOnlineStatuses };
