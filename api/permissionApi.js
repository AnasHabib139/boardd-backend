"use strict";

const { Router } = require("express");
const {
  getCompanyPermissions,
  updateSinglePermission,
  bulkUpdatePermissions,
  getCompanyUsers,
  getPermissionCategories,
  resetPermissions,
} = require("../controller/permission.controller");
const Auth = require("../middlewares/Auth");
const { checkPermission } = require("../middlewares/checkPermission");
const { ROLES } = require("../utils/constants");
const {
  validateUpdateSinglePermission,
  validateBulkUpdatePermissions,
} = require("../validation/permissionValidation");

class PermissionApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // GET /api/permissions - Get company permission policy
    // Only admins or users with viewPermissions can access
    router.get(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("viewPermissions"),
      getCompanyPermissions
    );

    // GET /api/permissions/categories - Get permission categories
    // Public endpoint for building UI
    router.get(
      "/categories",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("viewPermissions"),
      getPermissionCategories
    );

    // GET /api/permissions/users - Get company users for custom selection
    // Only admins can access
    router.get(
      "/users",
      Auth([ROLES.ADMIN]),
      getCompanyUsers
    );

    // POST /api/permissions/update - Update single permission
    // Only admins can modify permissions
    router.post(
      "/update",
      Auth([ROLES.ADMIN]),
      validateUpdateSinglePermission,
      updateSinglePermission
    );

    // POST /api/permissions/bulk-update - Bulk update permissions
    // Only admins can modify permissions
    router.post(
      "/bulk-update",
      Auth([ROLES.ADMIN]),
      validateBulkUpdatePermissions,
      bulkUpdatePermissions
    );

    // POST /api/permissions/reset - Reset all permissions to defaults
    // Only admins can reset permissions
    router.post(
      "/reset",
      Auth([ROLES.ADMIN]),
      resetPermissions
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/permissions";
  }
}

module.exports = PermissionApi;
