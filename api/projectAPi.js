"use strict";

const { Router } = require("express");
const {
  CreateProject,
  getProjectsOfTab,
  getProjectsOverview,
  getProjectById,
  toggleProjectPin,
  toggleProjectStatus,
  deleteProjectById,
  updateProjectById,
} = require("../controller/projectController");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateProject,
  validateUpdateProject,
  validateProjectIdParam,
  validateGetProjectsQuery,
} = require("../validation/projectValidation");

class ProjectAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Create project with validation
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateProject,
      CreateProject
    );

    // Get projects of a specific tab
    router.get(
      "/tab/:channelId/:tabId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.VIEWER]),
      validateGetProjectsQuery,
      getProjectsOfTab
    );

    // Get projects overview of a specific tab
    router.get(
      "/overview/tab/:channelId/:tabId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.VIEWER]),
      validateGetProjectsQuery,
      getProjectsOverview
    );

    // Get project by ID
    router.get(
      "/:projectId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.VIEWER]),
      validateProjectIdParam,
      getProjectById
    );

    // Toggle project pin status
    router.post(
      "/:projectId/pin",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectIdParam,
      toggleProjectPin
    );

    // Toggle project status (active/archived)
    router.post(
      "/:projectId/status",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectIdParam,
      toggleProjectStatus
    );

    // Update project details
    router.put(
      "/:projectId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectIdParam,
      validateUpdateProject,
      updateProjectById
    );

    // Delete project
    router.delete(
      "/:projectId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectIdParam,
      deleteProjectById
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/projects";
  }
}

module.exports = ProjectAPI;
