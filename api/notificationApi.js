"use strict";

const { Router } = require("express");
const {
  muteNotifications,
  unmuteNotifications,
  getMuteStatus,
} = require("../controller/notificationController");
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
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/notifications";
  }
}

module.exports = NotificationApi;