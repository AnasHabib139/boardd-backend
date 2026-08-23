"use strict";

const { Router } = require("express");
const {
  loginSuperAdmin,
  logoutSuperAdmin,
  createSuperAdmin,
  listSuperAdmins,
} = require("../controller/superAdmin.controller");
const SuperAdminAuth = require("../middlewares/SuperAdminAuth");
const {
  validateSuperAdminLogin,
  validateCreateSuperAdmin,
} = require("../validation/superAdminValidation");

class SuperAdminAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Login (public)
    router.post("/login", validateSuperAdminLogin, loginSuperAdmin);

    // Logout
    router.post("/logout", SuperAdminAuth(), logoutSuperAdmin);

    // Create admin
    router.post(
      "/admins",
      SuperAdminAuth(),
      validateCreateSuperAdmin,
      createSuperAdmin
    );

    // List admins
    router.get("/admins", SuperAdminAuth(), listSuperAdmins);
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/super-admin";
  }
}

module.exports = SuperAdminAPI;
