"use strict";

const { Router } = require("express");
const {
  createConnection,
  getConnections,
  deleteConnection,
  searchTasksForConnection,
} = require("../controller/taskConnection.controller");
const Auth = require("../middlewares/Auth");
const OptionalAuth = require("../middlewares/OptionalAuth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateTaskConnection,
  validateTaskIdParam,
  validateConnectionIdParam,
  validateSearchTasksQuery,
} = require("../validation/taskConnectionValidation");

class TaskConnectionApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    const router = this.router;

    // Create a task connection
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateTaskConnection,
      createConnection
    );

    // Search tasks by name within a channel (for connection dropdown)
    router.get(
      "/search",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateSearchTasksQuery,
      searchTasksForConnection
    );

    // Get all connections for a task
    router.get(
      "/:taskId",
      OptionalAuth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      getConnections
    );

    // Delete a task connection
    router.delete(
      "/:connectionId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateConnectionIdParam,
      deleteConnection
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/task-connections";
  }
}

module.exports = TaskConnectionApi;
