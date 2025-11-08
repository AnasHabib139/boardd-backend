"use strict";

const { Router } = require("express");
const {
  muteNotifications,
  unmuteNotifications,
  getMuteStatus,
} = require("../controller/notificationController");
const {
  getActivities,
  getUnreadCounts,
  markActivityAsRead,
  markAllAsRead,
} = require("../controller/activity.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateMuteNotifications,
} = require("../validation/notificationValidation");

class NotificationApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Mute notifications for a specific duration
    router.post(
      "/mute",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateMuteNotifications,
      muteNotifications
    );

    // Manually unmute notifications
    router.post(
      "/unmute",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      unmuteNotifications
    );

    // Alternative DELETE endpoint for unmute
    router.delete(
      "/mute",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      unmuteNotifications
    );

    // Get current mute status
    router.get(
      "/mute-status",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getMuteStatus
    );

    // ========== Activity Feed Endpoints ==========

    // Get activity feed with filtering and pagination
    router.get(
      "/feed",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getActivities
    );

    // Get unread counts by category
    router.get(
      "/feed/unread-counts",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getUnreadCounts
    );

    // Mark single activity as read
    router.post(
      "/feed/:activityId/mark-read",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      markActivityAsRead
    );

    // Mark all activities (or by type) as read
    router.post(
      "/feed/mark-all-read",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      markAllAsRead
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/notifications";
  }
}

module.exports = NotificationApi;