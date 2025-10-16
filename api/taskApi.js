"use strict";

const { Router } = require("express");
const {
  createTask,
  getTaskById,
  batchUpdateTask,
  shareTask,
  getTrendingTasks,
  getRecentActivities,
  getUserTasksByFilter,
  getUserPersonalTasksCalendar,
  archiveTask,
  deleteTaskPermanently,
} = require("../controller/task.controller");
const Auth = require("../middlewares/Auth");
const OptionalAuth = require("../middlewares/OptionalAuth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateTask,
  validateBatchUpdateTask,
  validateTaskIdParam,
  validateShareTask,
  validateTrendingTasksQuery,
  validateRecentActivitiesQuery,
  validateTaskFilterQuery,
} = require("../validation/taskValidation");

class TaskApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Create a new task with validation
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateTask,
      createTask
    );

    // Get user tasks by filter (today/overdue/yesterday) - MUST be before /:taskId
    router.get(
      "/my-work",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateTaskFilterQuery,
      getUserTasksByFilter
    );

    // Get task by ID with parameter validation (supports both authenticated and guest access)
    router.get(
      "/:taskId",
      OptionalAuth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      getTaskById
    );

    // Batch update task with validation
    router.put(
      "/:taskId/batch",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      validateBatchUpdateTask,
      batchUpdateTask
    );

    // Share task with multiple users via email and generate shareable link
    router.post(
      "/:taskId/share",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      validateShareTask,
      shareTask
    );

    // Get trending tasks for user (most clicked incomplete tasks)
    router.get(
      "/trending/list",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateTrendingTasksQuery,
      getTrendingTasks
    );

    // Get recent activities for user (all viewed tasks sorted by most recent view)
    router.get(
      "/recent/activities",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateRecentActivitiesQuery,
      getRecentActivities
    );

    // Get user's personal tasks for calendar view (across all channels)
    router.get(
      "/user/personal-calendar",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getUserPersonalTasksCalendar
    );

    // Toggle archive status (archive/unarchive task - toggles isActive)
    router.patch(
      "/:taskId/archive",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      archiveTask
    );

    // Delete task permanently (hard delete - removes from database)
    router.delete(
      "/:taskId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTaskIdParam,
      deleteTaskPermanently
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/tasks";
  }
}

module.exports = TaskApi;
