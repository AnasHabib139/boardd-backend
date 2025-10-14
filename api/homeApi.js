"use strict";

const { Router } = require("express");
const {
  getRecentlyViewed,
  getDashboardStats,
} = require("../controller/homeController");
const Auth = require("../middlewares/Auth");
const {
  validateGetRecentlyViewed,
  validateGetDashboardStats,
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

    /**
     * @route   GET /api/home/dashboard
     * @desc    Get dashboard statistics (user stats + channel task progress)
     * @access  Private
     * @query   search (optional), page (default: 1), limit (default: 20)
     */
    this.router.get(
      "/dashboard",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateGetDashboardStats,
      getDashboardStats
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
