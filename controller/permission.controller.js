"use strict";

const { generateResponse, parseBody } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const {
  findPermissionPolicy,
  updatePermission,
  bulkUpdatePermissions,
  getPermissionCategories,
  createPermissionPolicy,
} = require("../models/companyPermissionPolicyModel");
const { findUser } = require("../models/userModel");
const { Types } = require("mongoose");

/**
 * Helper function to populate customUserIds with full user details
 * @param {Object} policyObject - Plain policy object (use .toObject() on Mongoose doc)
 * @returns {Object} Policy object with populated customUsers arrays
 */
async function populateCustomUsers(policyObject) {
  // Collect all unique user IDs from customUserIds arrays
  const allUserIds = new Set();
  Object.keys(policyObject).forEach((key) => {
    if (policyObject[key]?.customUserIds && Array.isArray(policyObject[key].customUserIds)) {
      policyObject[key].customUserIds.forEach((userId) => {
        allUserIds.add(userId.toString());
      });
    }
  });

  // Fetch all users at once
  let userMap = {};
  if (allUserIds.size > 0) {
    const { model } = require("mongoose");
    const UserModel = model("User");

    const users = await UserModel.find(
      { _id: { $in: Array.from(allUserIds) } },
      {
        _id: 1,
        name: 1,
        email: 1,
        image: 1,
        coverImage: 1,
        dob: 1,
        nickname: 1,
        title: 1,
        designation: 1,
        role: 1,
        completeName: 1,
        gender: 1,
      }
    );

    // Create a map for quick lookup
    users.forEach((user) => {
      userMap[user._id.toString()] = {
        _id: user._id,
        name: user.name,
        email: user.email,
        image: user.image || null,
        coverImage: user.coverImage || null,
        dob: user.dob || null,
        nickname: user.nickname || null,
        title: user.title || null,
        designation: user.designation || null,
        role: user.role,
        firstName: user.completeName?.firstName || null,
        lastName: user.completeName?.lastName || null,
        gender: user.gender || null,
      };
    });
  }

  // Replace customUserIds with populated customUsers
  Object.keys(policyObject).forEach((key) => {
    if (policyObject[key]?.customUserIds && Array.isArray(policyObject[key].customUserIds)) {
      policyObject[key].customUsers = policyObject[key].customUserIds
        .map((userId) => userMap[userId.toString()])
        .filter(Boolean); // Remove any null values (users that don't exist)

      // Keep customUserIds for backward compatibility
      policyObject[key].customUserIds = policyObject[key].customUserIds.map(id => id.toString());
    }
  });

  return policyObject;
}

/**
 * GET /api/permissions
 * Get the company's permission policy
 */
exports.getCompanyPermissions = async (req, res, next) => {
  try {
    const user = await findUser({ _id: req.user.id });
    if (!user || !user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must belong to a company",
      });
    }
    const companyId = user.companyId;

    // Find permission policy
    let policy = await findPermissionPolicy(companyId);

    // If policy doesn't exist, create it with defaults
    if (!policy) {
      policy = await createPermissionPolicy(companyId);
    }

    // Populate customUserIds with user details
    const policyObject = await populateCustomUsers(policy.toObject());

    // Get permission categories for frontend
    const categories = getPermissionCategories();

    return generateResponse(
      {
        policy: policyObject,
        categories,
      },
      "Permission policy retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getCompanyPermissions:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch permissions",
    });
  }
};

/**
 * POST /api/permissions/update
 * Update a single permission
 *
 * Body: {
 *   permissionKey: "createChannels",
 *   accessLevel: "custom",
 *   customUserIds: ["userId1", "userId2"]
 * }
 */
exports.updateSinglePermission = async (req, res, next) => {
  try {
    const user = await findUser({ _id: req.user.id });
    if (!user || !user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must belong to a company",
      });
    }
    const companyId = user.companyId;
    const { permissionKey, accessLevel, customUserIds } = parseBody(req.body);

    // Validate inputs
    if (!permissionKey || !accessLevel) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "permissionKey and accessLevel are required",
      });
    }

    // Validate accessLevel
    const validAccessLevels = ["all", "admins", "members", "custom"];
    if (!validAccessLevels.includes(accessLevel)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Invalid accessLevel. Must be one of: ${validAccessLevels.join(", ")}`,
      });
    }

    // If accessLevel is "custom", validate customUserIds
    if (accessLevel === "custom") {
      if (!customUserIds || !Array.isArray(customUserIds) || customUserIds.length === 0) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "customUserIds array is required for custom access level",
        });
      }

      // Validate that all userIds are valid ObjectIds
      const invalidIds = customUserIds.filter(id => !Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Invalid user IDs provided",
        });
      }
    }

    // Find or create permission policy
    let policy = await findPermissionPolicy(companyId);
    if (!policy) {
      policy = await createPermissionPolicy(companyId);
    }

    // Update permission
    const updatedPolicy = await updatePermission(
      companyId,
      permissionKey,
      accessLevel,
      customUserIds || []
    );

    // Populate customUserIds with user details
    const policyObject = await populateCustomUsers(updatedPolicy.toObject());

    return generateResponse(
      policyObject,
      "Permission updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateSinglePermission:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update permission",
    });
  }
};

/**
 * POST /api/permissions/bulk-update
 * Update multiple permissions at once
 *
 * Body: {
 *   permissions: {
 *     createChannels: { accessLevel: "all", customUserIds: [] },
 *     deleteFiles: { accessLevel: "admins", customUserIds: [] },
 *     uploadFiles: { accessLevel: "custom", customUserIds: ["userId1"] }
 *   }
 * }
 */
exports.bulkUpdatePermissions = async (req, res, next) => {
  try {
    const user = await findUser({ _id: req.user.id });
    if (!user || !user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must belong to a company",
      });
    }
    const companyId = user.companyId;
    const { permissions } = parseBody(req.body);

    // Validate inputs
    if (!permissions || typeof permissions !== "object") {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "permissions object is required",
      });
    }

    // Validate each permission
    const validAccessLevels = ["all", "admins", "members", "custom"];
    for (const [key, value] of Object.entries(permissions)) {
      if (!value.accessLevel || !validAccessLevels.includes(value.accessLevel)) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Invalid accessLevel for ${key}. Must be one of: ${validAccessLevels.join(", ")}`,
        });
      }

      if (value.accessLevel === "custom") {
        if (!value.customUserIds || !Array.isArray(value.customUserIds) || value.customUserIds.length === 0) {
          return next({
            statusCode: STATUS_CODES.BAD_REQUEST,
            message: `customUserIds array is required for ${key} with custom access level`,
          });
        }
      }
    }

    // Find or create permission policy
    let policy = await findPermissionPolicy(companyId);
    if (!policy) {
      policy = await createPermissionPolicy(companyId);
    }

    // Bulk update permissions
    const updatedPolicy = await bulkUpdatePermissions(companyId, permissions);

    // Populate customUserIds with user details
    const policyObject = await populateCustomUsers(updatedPolicy.toObject());

    return generateResponse(
      policyObject,
      "Permissions updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in bulkUpdatePermissions:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update permissions",
    });
  }
};

/**
 * GET /api/permissions/users
 * Get list of company users for custom permission selection
 */
exports.getCompanyUsers = async (req, res, next) => {
  try {
    const user = await findUser({ _id: req.user.id });
    if (!user || !user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must belong to a company",
      });
    }
    const companyId = user.companyId;

    // Get all active users in the company
    const { model } = require("mongoose");
    const UserModel = model("User");

    const users = await UserModel.find(
      {
        companyId: new Types.ObjectId(companyId),
        isActive: true,
      },
      {
        _id: 1,
        name: 1,
        email: 1,
        image: 1,
        role: 1,
      }
    ).sort({ name: 1 });

    return generateResponse(
      { users },
      "Users retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getCompanyUsers:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch users",
    });
  }
};

/**
 * GET /api/permissions/categories
 * Get permission categories and keys
 * Useful for frontend to build the UI dynamically
 */
exports.getPermissionCategories = async (req, res, next) => {
  try {
    const categories = getPermissionCategories();

    return generateResponse(
      categories,
      "Permission categories retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getPermissionCategories:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch categories",
    });
  }
};

/**
 * POST /api/permissions/reset
 * Reset all permissions to default values
 * Only admins can do this
 */
exports.resetPermissions = async (req, res, next) => {
  try {
    const user = await findUser({ _id: req.user.id });
    if (!user || !user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must belong to a company",
      });
    }
    const companyId = user.companyId;

    // Delete existing policy
    const { model } = require("mongoose");
    const CompanyPermissionPolicyModel = model("CompanyPermissionPolicy");

    await CompanyPermissionPolicyModel.deleteOne({ companyId });

    // Create new policy with defaults
    const newPolicy = await createPermissionPolicy(companyId);

    // Populate customUserIds with user details
    const policyObject = await populateCustomUsers(newPolicy.toObject());

    return generateResponse(
      policyObject,
      "Permissions reset to default values",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in resetPermissions:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to reset permissions",
    });
  }
};
