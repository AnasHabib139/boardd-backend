"use strict";

const { Router } = require("express");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateProjectStatusColumn,
  validateDeleteProjectStatusColumn,
  validateUpdateProjectStatusColumn,
} = require("../validation/projectStatusColumnValidation");
const {
  createProjectStatusColumn,
  deleteProjectStatusColumn,
  updateProjectStatusColumn,
} = require("../controller/projectStatusColumnController");

class ProjectStatusColumnApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    /**
     * @route POST /api/tabs/:tabId/columns
     * @desc Create a new column for tab (applies to all projects in tab)
     * @access Private
     */
    router.post(
      "/tabs/:tabId/columns",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateProjectStatusColumn,
      createProjectStatusColumn
    );

    /**
     * @route DELETE /api/tabs/:tabId/columns/:columnId
     * @desc Delete a column and remove it from all tasks in the tab
     * @access Private
     */
    router.delete(
      "/tabs/:tabId/columns/:columnId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateDeleteProjectStatusColumn,
      deleteProjectStatusColumn
    );

    /**
     * @route PATCH /api/tabs/:tabId/columns/:columnId
     * @desc Update a column (currently supports name changes)
     * @access Private
     */
    router.patch(
      "/tabs/:tabId/columns/:columnId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateUpdateProjectStatusColumn,
      updateProjectStatusColumn
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/project-status-columns";
  }
}

module.exports = ProjectStatusColumnApi;
