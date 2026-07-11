"use strict";

const { Router } = require("express");
const { createTaskComment, updateTaskComment, getTaskComments, deleteTaskComment, getCommentReplies, toggleCommentReaction } = require("../controller/taskComment.controller");
const Auth = require("../middlewares/Auth");
const OptionalAuth = require("../middlewares/OptionalAuth");
const { checkPermission } = require("../middlewares/checkPermission");
const { ROLES } = require("../utils/constants");
const {
  validateCreateTaskComment,
  validateTaskIdParam,
  validateGetTaskCommentsQuery,
  validateDeleteTaskCommentParams,
  validateToggleReaction,
  validateGetRepliesQuery,
} = require("../validation/taskCommentValidation");

class TaskCommentApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Get all comments for a specific task (supports unauthenticated access for shared task links)
    router.get(
      "/:taskId/comments",
      OptionalAuth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      validateGetTaskCommentsQuery,
      getTaskComments
    );

    // Get replies for a comment (supports unauthenticated access for shared task links)
    router.get(
      "/:taskId/comments/:commentId/replies",
      OptionalAuth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateDeleteTaskCommentParams,
      validateGetRepliesQuery,
      getCommentReplies
    );

    // Toggle an emoji reaction on a comment
    router.post(
      "/:taskId/comments/:commentId/reactions/toggle",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("makeComments"),
      validateDeleteTaskCommentParams,
      validateToggleReaction,
      toggleCommentReaction
    );

    // Create a new comment on a task
    router.post(
      "/:taskId/comments",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("makeComments"),
      validateTaskIdParam,
      validateCreateTaskComment,
      createTaskComment
    );

    // Update a comment on a task (author only, retriggers mention notifications)
    router.put(
      "/:taskId/comments/:commentId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("makeComments"),
      validateDeleteTaskCommentParams,
      validateCreateTaskComment,
      updateTaskComment
    );

    // Delete a comment on a task
    router.delete(
      "/:taskId/comments/:commentId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("makeComments"),
      validateDeleteTaskCommentParams,
      deleteTaskComment
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
