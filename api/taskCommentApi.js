"use strict";

const { Router } = require("express");
const { createTaskComment } = require("../controller/taskComment.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateTaskComment,
  validateTaskIdParam,
} = require("../validation/taskCommentValidation");

class TaskCommentApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Create a new comment on a task
    router.post(
      "/:taskId/comments",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      validateCreateTaskComment,
      createTaskComment
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/tasks";
  }
}

module.exports = TaskCommentApi;
