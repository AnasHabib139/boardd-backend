"use strict";

const { Router } = require("express");
const {
  CreateProject,
  getProjectsOfTab,
  toggleProjectPin,
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

    // Toggle project pin status
    router.post(
      "/:projectId/pin",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateProjectIdParam,
      toggleProjectPin
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
