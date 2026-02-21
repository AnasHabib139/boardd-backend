"use strict";

const { Router } = require("express");
const subtaskController = require("../controller/subtask.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateSubtask,
  validateUpdateSubtask,
  validateSubtaskIdParam,
  validateGetSubtasksQuery,
} = require("../validation/subtaskValidation");

class SubtaskApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Create a new subtask with validation
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateSubtask,
      subtaskController.createSubtask
    );

    // Get subtask by ID
    router.get(
      "/:subtaskId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateSubtaskIdParam,
      subtaskController.getSubtaskById
    );

    // Update subtask with validation
    router.put(
      "/:subtaskId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateSubtaskIdParam,
      validateUpdateSubtask,
      subtaskController.updateSubtask
    );

    // Delete subtask with parameter validation
    router.delete(
      "/:subtaskId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateSubtaskIdParam,
      subtaskController.deleteSubtask
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/subtasks";
  }
}

module.exports = SubtaskApi;
