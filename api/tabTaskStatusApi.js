"use strict";

const { Router } = require("express");
const {
  getProjectStatuses,
  createStatus,
  updateStatus,
  updateStatusClosingFlag,
  deleteStatus,
  reorderStatuses,
} = require("../controller/tabTaskStatusController");
const Auth = require("../middlewares/Auth");
const OptionalAuth = require("../middlewares/OptionalAuth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateStatus,
  validateUpdateStatus,
  validateUpdateClosingFlag,
  validateReorderStatuses,
  validateProjectId,
  validateStatusId,
} = require("../validation/tabTaskStatusValidation");

class TabTaskStatusApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Get all statuses for a project
    router.get(
      "/projects/:projectId/statuses",
      OptionalAuth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectId,
      getProjectStatuses
    );

    // Create a new custom status
    router.post(
      "/projects/:projectId/statuses",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectId,
      validateCreateStatus,
      createStatus
    );

    // Reorder statuses (must be before :statusId route)
    router.post(
      "/projects/:projectId/statuses/reorder",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectId,
      validateReorderStatuses,
      reorderStatuses
    );

    // Update a status
    router.patch(
      "/projects/:projectId/statuses/:statusId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectId,
      validateStatusId,
      validateUpdateStatus,
      updateStatus
    );

    // Mark/unmark a status as closing
    router.patch(
      "/projects/:projectId/statuses/:statusId/closing",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectId,
      validateStatusId,
      validateUpdateClosingFlag,
      updateStatusClosingFlag
    );

    // Delete a status
    router.delete(
      "/projects/:projectId/statuses/:statusId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectId,
      validateStatusId,
      deleteStatus
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/project-statuses";
  }
}

module.exports = TabTaskStatusApi;
