"use strict";

const { Router } = require("express");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateProjectStatusColumn,
} = require("../validation/projectStatusColumnValidation");
const {
  createProjectStatusColumn,
} = require("../controller/projectStatusColumnController");

class ProjectStatusColumnApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    /**
     * @route POST /api/projects/:projectId/columns/:status
     * @desc Create a new column for specific project status
     * @access Private
     */
    router.post(
      "/:projectId/columns/:status",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateProjectStatusColumn,
      createProjectStatusColumn
    );

  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/projects-columns";
  }
}

module.exports = ProjectStatusColumnApi;
