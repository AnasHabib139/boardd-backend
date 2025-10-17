"use strict";

const { Router } = require("express");
const { createTaskComment, getTaskComments } = require("../controller/taskComment.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateTaskComment,
  validateTaskIdParam,
  validateGetTaskCommentsQuery,
} = require("../validation/taskCommentValidation");

class TaskCommentApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Get all comments for a specific task
    router.get(
      "/:taskId/comments",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      validateGetTaskCommentsQuery,
      getTaskComments
    );

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
    return "/tasks-comments";
  }
}

module.exports = TaskCommentApi;
