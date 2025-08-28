"use strict";

const { Router } = require("express");
const {
  getCompanyUsersAdmin,
  getInvitedUsers,
  cancelInvite,
  toggleUserSeat,
  initiateOwnershipTransfer,
  confirmOwnershipTransfer,
  changeUserRole,
} = require("../controller/admin.controller");
const { ROLES } = require("../utils/constants");
const Auth = require("../middlewares/Auth");
const {
  validateToggleUserSeat,
  validateInitiateOwnershipTransfer,
  validateConfirmOwnershipTransfer,
} = require("../validation/adminValidation");

class AdminAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Get all company users for admin management
    router.get("/users", Auth([ROLES.ADMIN]), getCompanyUsersAdmin);

    // Get invited users from reserved invite slots
    router.get("/invited-users", Auth([ROLES.ADMIN]), getInvitedUsers);

    // Cancel an invite for a specific user by slot ID
    router.delete("/cancel-invite/:slotId", Auth([ROLES.ADMIN]), cancelInvite);

    // Toggle user seat status (approve/disapprove)
    router.post(
      "/toggle-seat",
      Auth([ROLES.ADMIN]),
      validateToggleUserSeat,
      toggleUserSeat
    );

    // Initiate ownership transfer (requires admin and sends email)
    router.post(
      "/transfer-ownership",
      Auth([ROLES.ADMIN]),
      validateInitiateOwnershipTransfer,
      initiateOwnershipTransfer
    );

    // Confirm ownership transfer via token (public JSON API)
    router.post(
      "/confirm-ownership-transfer",
      validateConfirmOwnershipTransfer,
      confirmOwnershipTransfer
    );

    // Change user role
    router.put(
      "/change-role",
      Auth([ROLES.ADMIN]),
      changeUserRole
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
