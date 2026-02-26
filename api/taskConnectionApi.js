"use strict";

const { Router } = require("express");
const {
  createConnection,
  getConnections,
  deleteConnection,
} = require("../controller/taskConnection.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateTaskConnection,
  validateTaskIdParam,
  validateConnectionIdParam,
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

    // Get all connections for a task
    router.get(
      "/:taskId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
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
