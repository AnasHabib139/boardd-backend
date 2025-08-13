"use strict";

const { Router } = require("express");
const {
  getCompanyUsersAdmin,
  getInvitedUsers,
  cancelInvite,
  toggleUserSeat,
} = require("../controller/admin.controller");
const { ROLES } = require("../utils/constants");
const Auth = require("../middlewares/Auth");
const {
  validateToggleUserSeat,
} = require("../validation/adminValidation");

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

    // Cancel an invite for a specific user by slot ID
    router.delete(
      "/cancel-invite/:slotId",
      Auth([ROLES.ADMIN]),
      cancelInvite
    );

    // Toggle user seat status (approve/disapprove)
    router.post(
      "/toggle-seat",
      Auth([ROLES.ADMIN]),
      validateToggleUserSeat,
      toggleUserSeat
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