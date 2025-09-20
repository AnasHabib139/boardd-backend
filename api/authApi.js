"use strict";

const { Router } = require("express");
const {
  refreshToken,
  logout,
  logoutAllDevices,
  getActiveSessions,
  revokeSession,
} = require("../controller/auth.controller");
const { forgotPassword } = require("../controller/forgotPasswordController");
const { validateForgotPassword } = require("../validation/forgotPasswordValidation");
const { ROLES } = require("../utils/constants");
const Auth = require("../middlewares/Auth");

class AuthAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // POST /auth/refresh-token - No auth required (uses refresh token from cookie)
    router.post("/refresh-token", refreshToken);

    // POST /auth/forgot-password - No auth required (public endpoint)
    router.post("/forgot-password", validateForgotPassword, forgotPassword);

    // POST /auth/logout - Requires authentication
    router.post("/logout", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), logout);

    // POST /auth/logout-all-devices - Requires authentication
    router.post(
      "/logout-all-devices",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      logoutAllDevices
    );

    // GET /auth/active-sessions - Requires authentication
    router.get(
      "/active-sessions",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getActiveSessions
    );

    // DELETE /auth/revoke-session/:tokenId - Requires authentication
    router.delete(
      "/revoke-session/:tokenId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      revokeSession
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/auth";
  }
}

module.exports = AuthAPI;
