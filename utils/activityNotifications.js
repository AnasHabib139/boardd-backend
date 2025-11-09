"use strict";

/**
 * Activity Notifications Utility
 * Handles emitting unread count updates to users
 * Separated from socket.js to avoid circular dependencies
 */

/**
 * Emit updated unread counts to user
 * @param {String} userId - User ID to emit to
 * @param {Object} io - Socket.io instance (required)
 */
exports.emitUnreadCountsUpdate = async (userId, io) => {
  try {
    if (!io) {
      console.error("Socket.io instance is required for emitUnreadCountsUpdate");
      return;
    }

    const { model } = require("mongoose");
    const { calculateUnreadCounts } = require("../controller/helpers/activities/activity.helper");

    const NotificationModel = model("Notification");
    const unreadCounts = await calculateUnreadCounts(NotificationModel, userId);

    io.to(`user:${userId}`).emit("activity:unread:updated", unreadCounts);
  } catch (error) {
    console.error("Error emitting unread counts update:", error);
  }
};
