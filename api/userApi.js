"use strict";

const { Router } = require("express");
const {
  signup,
  login,
  getUsersOfCompany,
  getUserProfile,
  updateUserSettings,
} = require("../controller/user.controller");
const { ROLES } = require("../utils/constants");
const Auth = require("../middlewares/Auth");
const {
  validateSignup,
  validateLogin,
} = require("../validation/userValidation");
const { validateUpdateUserSettings } = require("../validation/userSettingsValidation");

class UserAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Admin signup with validation
    router.post("/admin/signup", validateSignup, signup);

    // Login with validation (tokens are optional, handled in controller)
    router.post("/login", validateLogin, login);

    // Get users with query validation
    router.get("/", Auth([ROLES.ADMIN]), getUsersOfCompany);

    // Get user profile
    router.get(
      "/profile",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      getUserProfile
    );

    // Update user settings and profile
    router.put(
      "/settings",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateUpdateUserSettings,
      updateUserSettings
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/users";
  }
}

module.exports = UserAPI;
