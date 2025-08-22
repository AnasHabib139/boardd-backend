"use strict";

const { Router } = require("express");
const { getUserInbox } = require("../controller/inbox.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { validateInboxQuery } = require("../validation/inboxValidation");

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
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/inbox";
  }
}

module.exports = InboxApi;