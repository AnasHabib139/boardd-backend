"use strict";

const { Router } = require("express");
const {
  getCompanyUsersAdmin,
  getInvitedUsers,
} = require("../controller/admin.controller");
const { ROLES } = require("../utils/constants");
const Auth = require("../middlewares/Auth");

class AdminAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Get all company users for admin management
    router.get(
      "/users", 
      Auth([ROLES.ADMIN]), 
      getCompanyUsersAdmin
    );

    // Get invited users from reserved invite slots
    router.get(
      "/invited-users",
      Auth([ROLES.ADMIN]),
      getInvitedUsers
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/admin";
  }
}

module.exports = AdminAPI;