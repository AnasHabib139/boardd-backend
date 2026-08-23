"use strict";

const { Router } = require("express");
const {
  loginSuperAdmin,
  logoutSuperAdmin,
  createSuperAdmin,
  listSuperAdmins,
  updateCompanyStatus,
  getCompanyAuditLogHandler,
  getAllCompanies,
  getCompanyDetail,
  getCompanyUsers,
} = require("../controller/superAdmin.controller");
const SuperAdminAuth = require("../middlewares/SuperAdminAuth");
const {
  validateSuperAdminLogin,
  validateCreateSuperAdmin,
  validateUpdateCompanyStatus,
  validateCompanyIdParams,
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

    // List companies
    router.get("/companies", SuperAdminAuth(), getAllCompanies);

    // Get company detail
    router.get(
      "/companies/:companyId",
      SuperAdminAuth(),
      validateCompanyIdParams,
      getCompanyDetail
    );

    // Get company users
    router.get(
      "/companies/:companyId/users",
      SuperAdminAuth(),
      validateCompanyIdParams,
      getCompanyUsers
    );

    // Update company status (enable/disable)
    router.put(
      "/companies/:companyId/status",
      SuperAdminAuth(),
      validateUpdateCompanyStatus,
      updateCompanyStatus
    );

    // Get company audit log
    router.get(
      "/companies/:companyId/audit-log",
      SuperAdminAuth(),
      getCompanyAuditLogHandler
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/super-admin";
  }
}

module.exports = SuperAdminAPI;
