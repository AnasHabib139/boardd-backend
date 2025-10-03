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

module.exports = { initRedis, getRedis, closeRedis };
