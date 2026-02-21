"use strict";

/**
 * Inbox Notifications Utility
 * Handles emitting inbox unread count updates to users
 * Separated from socket.js to avoid circular dependencies
 * (follows same pattern as activityNotifications.js)
 */

/**
 * Emit updated inbox unread counts to user
 * @param {String} userId - User ID to emit to
 * @param {Object} io - Socket.io instance (required)
 */
exports.emitInboxUnreadUpdate = async (userId, io) => {
  try {
    if (!io) {
      console.error("Socket.io instance is required for emitInboxUnreadUpdate");
      return;
    }

    const { model } = require("mongoose");
    const {
      getImportantInboxUnreadCountQuery,
      getOutboxInboxUnreadCountQuery,
    } = require("../controller/queries/inboxQueries");

    const TaskModel = model("Task");

    const [importantResult, outboxResult] = await Promise.all([
      TaskModel.aggregate(getImportantInboxUnreadCountQuery(userId)),
      TaskModel.aggregate(getOutboxInboxUnreadCountQuery(userId)),
    ]);

    const important = importantResult[0]?.count || 0;
    const outbox = outboxResult[0]?.count || 0;

    io.to(`user:${userId}`).emit("inbox:unread:updated", {
      important,
      outbox,
      total: important + outbox,
    });
  } catch (error) {
    console.error("Error emitting inbox unread update:", error);
  }
};
