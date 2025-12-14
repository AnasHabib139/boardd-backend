"use strict";

const { Router } = require("express");
const {
  getProjectStatuses,
  createStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
} = require("../controller/tabTaskStatusController");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateStatus,
  validateUpdateStatus,
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
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
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
