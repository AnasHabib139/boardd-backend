"use strict";

const { Router } = require("express");
const {
  setUserStatus,
  getUserStatus,
  clearUserStatus,
  getStatusOptions,
} = require("../controller/userStatusController");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateSetUserStatus,
} = require("../validation/userStatusValidation");

class UserStatusApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Set or update user status
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateSetUserStatus,
      setUserStatus
    );

    // Get user status by ID
    router.get(
      "/:userId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getUserStatus
    );

    // Clear current user's status
    router.delete(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      clearUserStatus
    );

    // Get predefined status options
    router.get(
      "/options/list",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getStatusOptions
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/user-status";
  }
}

module.exports = UserStatusApi;