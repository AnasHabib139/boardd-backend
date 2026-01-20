"use strict";

const { STATUS_CODES } = require("../utils/constants");
const { findPermissionPolicy, hasPermission } = require("../models/companyPermissionPolicyModel");

/**
 * Permission Check Middleware
 * Verifies if the authenticated user has permission to perform a specific action
 *
 * @param {String} permissionKey - The permission to check (e.g., "createChannels", "deleteFiles")
 * @returns {Function} Express middleware function
 *
 * Usage:
 * router.post('/channels', authenticateUser, checkPermission('createChannels'), createChannel);
 */
function checkPermission(permissionKey) {
  return async (req, res, next) => {
    try {
      // Ensure user is authenticated (should be set by Auth middleware)
      if (!req.user || !req.user.id) {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Authentication required",
        });
      }

      const userId = req.user.id;
      let companyId = req.user.companyId;
      let userRole = req.user.role; // "admin", "employee", "guest", "demo_user"

      // If companyId not in JWT, fetch from database
      if (!companyId) {
        const { findUser } = require("../models/userModel");
        const user = await findUser({ _id: userId });
        if (!user || !user.companyId) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "User must belong to a company to perform this action",
          });
        }
        companyId = user.companyId;
        userRole = user.role; // Also update role from DB
      }

      // Map user role to permission level
      // "employee" in DB = "member" in permission system
      // "demo_user" treated as "member"
      let permissionRole = userRole;
      if (userRole === "employee" || userRole === "demo_user") {
        permissionRole = "member";
      }

      // Check permission using the model helper
      const permitted = await hasPermission(
        companyId,
        userId,
        permissionRole,
        permissionKey
      );

      if (!permitted) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You do not have permission to perform this action",
        });
      }

      // Permission granted, proceed
      next();
    } catch (error) {
      console.error(`Permission check error for ${permissionKey}:`, error);
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Permission verification failed",
      });
    }
  };
}

/**
 * Optional Permission Check Middleware
 * Same as checkPermission but doesn't fail if policy doesn't exist
 * Useful for gradual rollout or non-critical features
 *
 * @param {String} permissionKey - The permission to check
 * @returns {Function} Express middleware function
 */
function checkPermissionOptional(permissionKey) {
  return async (req, res, next) => {
    try {
      // If permission check succeeds, continue
      // If it fails due to missing policy, continue anyway
      // If it fails due to denied permission, block

      if (!req.user || !req.user.id || !req.user.companyId) {
        // No user/company, proceed (let other middleware handle auth)
        return next();
      }

      const userId = req.user.id;
      const companyId = req.user.companyId;
      const userRole = req.user.role;

      // Map role
      let permissionRole = userRole;
      if (userRole === "employee" || userRole === "demo_user") {
        permissionRole = "member";
      }

      // Check if policy exists
      const policy = await findPermissionPolicy(companyId);
      if (!policy) {
        // No policy exists, allow access (graceful degradation)
        return next();
      }

      // Policy exists, enforce it
      const permitted = await hasPermission(
        companyId,
        userId,
        permissionRole,
        permissionKey
      );

      if (!permitted) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You do not have permission to perform this action",
        });
      }

      next();
    } catch (error) {
      console.error(`Optional permission check error for ${permissionKey}:`, error);
      // On error, fail open (allow access)
      next();
    }
  };
}

/**
 * Batch Permission Check Middleware
 * Checks if user has ANY of the specified permissions (OR logic)
 *
 * @param {Array<String>} permissionKeys - Array of permission keys
 * @returns {Function} Express middleware function
 *
 * Usage:
 * checkAnyPermission(['deleteFiles', 'deleteOthersChannels'])
 */
function checkAnyPermission(permissionKeys) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Authentication required",
        });
      }

      const userId = req.user.id;
      const companyId = req.user.companyId;
      const userRole = req.user.role;

      if (!companyId) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "User must belong to a company to perform this action",
        });
      }

      // Map role
      let permissionRole = userRole;
      if (userRole === "employee" || userRole === "demo_user") {
        permissionRole = "member";
      }

      // Check if user has ANY of the permissions
      const permissionChecks = await Promise.all(
        permissionKeys.map((key) =>
          hasPermission(companyId, userId, permissionRole, key)
        )
      );

      const hasAnyPermission = permissionChecks.some((result) => result === true);

      if (!hasAnyPermission) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You do not have permission to perform this action",
        });
      }

      next();
    } catch (error) {
      console.error(`Batch permission check error:`, error);
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Permission verification failed",
      });
    }
  };
}

/**
 * Permission check with self-join bypass for channel add-member
 * Skips permission check if user is only adding themselves
 *
 * @param {String} permissionKey - The permission to check
 * @returns {Function} Express middleware function
 *
 * Usage:
 * router.put('/add-member', checkPermissionWithSelfJoinBypass('addRemoveChannelMembers'), addUserToChannel);
 */
function checkPermissionWithSelfJoinBypass(permissionKey) {
  return async (req, res, next) => {
    try {
      const { emails } = req.body || {};

      if (!req.user || !req.user.id) {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Authentication required",
        });
      }

      // Get user email for comparison
      const { findUser } = require("../models/userModel");
      const user = await findUser({ _id: req.user.id });

      if (!user) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "User not found",
        });
      }

      // Check if self-join: only 1 email and it matches logged-in user
      const DEMO_EMAIL = "uncle@boardd.demo";
      const nonDemoEmails = (emails || []).filter(
        (email) => email.toLowerCase() !== DEMO_EMAIL.toLowerCase()
      );

      const isSelfJoin =
        nonDemoEmails.length === 1 &&
        nonDemoEmails[0].toLowerCase() === user.email.toLowerCase();

      if (isSelfJoin) {
        // Skip permission check for self-join
        return next();
      }

      // Not self-join, run normal permission check
      return checkPermission(permissionKey)(req, res, next);
    } catch (error) {
      console.error(`Self-join bypass check error:`, error);
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Permission verification failed",
      });
    }
  };
}

/**
 * Batch Permission Check Middleware (AND logic)
 * Checks if user has ALL of the specified permissions
 *
 * @param {Array<String>} permissionKeys - Array of permission keys
 * @returns {Function} Express middleware function
 *
 * Usage:
 * checkAllPermissions(['createForms', 'createDocuments'])
 */
function checkAllPermissions(permissionKeys) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return next({
          statusCode: STATUS_CODES.UNAUTHORIZED,
          message: "Authentication required",
        });
      }

      const userId = req.user.id;
      const companyId = req.user.companyId;
      const userRole = req.user.role;

      if (!companyId) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "User must belong to a company to perform this action",
        });
      }

      // Map role
      let permissionRole = userRole;
      if (userRole === "employee" || userRole === "demo_user") {
        permissionRole = "member";
      }

      // Check if user has ALL of the permissions
      const permissionChecks = await Promise.all(
        permissionKeys.map((key) =>
          hasPermission(companyId, userId, permissionRole, key)
        )
      );

      const hasAllPermissions = permissionChecks.every((result) => result === true);

      if (!hasAllPermissions) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You do not have permission to perform this action",
        });
      }

      next();
    } catch (error) {
      console.error(`Batch permission check error:`, error);
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Permission verification failed",
      });
    }
  };
}

module.exports = {
  checkPermission,
  checkPermissionOptional,
  checkAnyPermission,
  checkAllPermissions,
  checkPermissionWithSelfJoinBypass,
};
