"use strict";

const { Router } = require("express");
const { getUserInbox, getInboxUnreadCount, toggleReadStatus, toggleClearedStatus, markAllAsRead } = require("../controller/inbox.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { validateInboxQuery, validateTaskIdParam, validateMarkAllAsReadQuery } = require("../validation/inboxValidation");

class InboxApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Get user's inbox tasks with filters (important/outbox/cleared)
    router.get(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateInboxQuery,
      getUserInbox
    );

    // Get inbox unread counts (important + outbox)
    router.get(
      "/unread-count",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getInboxUnreadCount
    );

    // Mark all inbox tasks as read for a filter (important or outbox)
    // Must be before /:taskId/read to avoid "read-all" being matched as a taskId
    router.patch(
      "/read-all",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateMarkAllAsReadQuery,
      markAllAsRead
    );

    // Toggle read status of inbox entry (read/unread)
    router.patch(
      "/:taskId/read",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      toggleReadStatus
    );

    // Toggle cleared status of inbox entry (clear/restore)
    router.patch(
      "/:taskId/clear",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      toggleClearedStatus
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/inbox";
  }
}

module.exports = InboxApi;