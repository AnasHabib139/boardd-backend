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
  getAllPlatformUsers,
  getPlatformUserDetail,
  getStatsOverview,
  getStatsGrowth,
} = require("../controller/superAdmin.controller");
const SuperAdminAuth = require("../middlewares/SuperAdminAuth");
const {
  validateSuperAdminLogin,
  validateCreateSuperAdmin,
  validateUpdateCompanyStatus,
  validateCompanyIdParams,
  validateUserIdParams,
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
      validateCompanyIdParams,
      getCompanyAuditLogHandler
    );

    // List platform users (cross-company, no companyId filter)
    router.get("/users", SuperAdminAuth(), getAllPlatformUsers);

    // Get platform user detail
    router.get(
      "/users/:userId",
      SuperAdminAuth(),
      validateUserIdParams,
      getPlatformUserDetail
    );

    // Stats overview (counts)
    router.get("/stats/overview", SuperAdminAuth(), getStatsOverview);

    // Stats growth (day-bucketed over range)
    router.get("/stats/growth", SuperAdminAuth(), getStatsGrowth);
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/super-admin";
  }
}

module.exports = SuperAdminAPI;
