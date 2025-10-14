"use strict";

const { Router } = require("express");
const {
  getContributions,
  getActivities,
  markAllTasksAsCompleted,
} = require("../controller/workProgressController");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateGetContributions,
  validateGetActivities,
  validateMarkAllComplete,
} = require("../validation/workProgressValidation");

class WorkProgressApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Get contributions data for work progress graph (channel-wide)
    router.get(
      "/contributions/:channelId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetContributions,
      getContributions
    );

    // Get activities for work progress activity feed (channel-wide)
    router.get(
      "/activities/:channelId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetActivities,
      getActivities
    );

    // Mark all tasks in channel as completed
    router.post(
      "/:channelId/complete-all",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateMarkAllComplete,
      markAllTasksAsCompleted
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/work-progress";
  }
}

module.exports = WorkProgressApi;
