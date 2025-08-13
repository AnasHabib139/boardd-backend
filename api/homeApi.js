"use strict";

const { Router } = require("express");
const {
  getRecentlyViewed,
} = require("../controller/homeController");
const Auth = require("../middlewares/Auth");
const {
  validateGetRecentlyViewed,
} = require("../validation/homeValidation");
const { ROLES } = require("../utils/constants");

class HomeApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    /**
     * @route   GET /api/home/recent
     * @desc    Get combined recently viewed items (forms + tasks) for dashboard
     * @access  Private
     * @query   limit, page
     */
    this.router.get(
      "/recent",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateGetRecentlyViewed,
      getRecentlyViewed
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/home";
  }
}

module.exports = HomeApi;
