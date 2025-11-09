const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");

// Valid access levels
const ACCESS_LEVELS = ["all", "admins", "members", "custom"];

// Valid permission keys (all 36 permissions)
const PERMISSION_KEYS = [
  // Account and Channels - Accounts
  "inviteNonAuthorizedDomains",
  "inviteGuests",
  "uploadFiles",
  "deleteFiles",
  "createChannels",
  "mentionEveryone",
  "createAutomations",
  "editSchedules",
  // Account and Channels - Channels
  "createPrivateChannels",
  "createShareableChannels",
  "deleteSelfOwnedChannels",
  "deleteOthersChannels",
  "moveGroupsToWorkspace",
  // Forms, Documents and Dashboard - Forms/Documents
  "createForms",
  "createDocuments",
  "deleteSelfForms",
  "deleteSelfDocuments",
  // Forms, Documents and Dashboard - Dashboard
  "editDashboardTabs",
  "deleteDashboardTabs",
  // User Management and Communication - User Management
  "deleteUserOwnedContent",
  "editTeamNameImage",
  "addRemoveChannelMembers",
  "manageAllMembers",
  "viewTeamManagement",
  "uploadProfilePicture",
  // User Management and Communication - Communication
  "muteAllNotifications",
  "editSelfOwnedItems",
  "deleteSelfOwnedItems",
  "makeComments",
  "editDeleteComments",
  // Admin Privileges
  "viewPermissions",
  "accessUserManagement",
  "accessSecurity",
  "accessBilling",
  "accessClientPayments",
];

/**
 * Validation schema for updating a single permission
 */
const updateSinglePermissionSchema = Joi.object({
  permissionKey: Joi.string()
    .valid(...PERMISSION_KEYS)
    .required()
    .messages({
      "any.only": `Permission key must be one of the valid permission keys`,
      "any.required": "Permission key is required",
    }),

  accessLevel: Joi.string()
    .valid(...ACCESS_LEVELS)
    .required()
    .messages({
      "any.only": `Access level must be one of: ${ACCESS_LEVELS.join(", ")}`,
      "any.required": "Access level is required",
    }),

  customUserIds: Joi.when("accessLevel", {
    is: "custom",
    then: Joi.array()
      .items(Joi.string().regex(/^[0-9a-fA-F]{24}$/))
      .required()
      .min(1)
      .messages({
        "array.base": "Custom user IDs must be an array",
        "array.min": "At least one user ID is required for custom access level",
        "string.pattern.base": "Invalid user ID format",
      }),
    otherwise: Joi.array()
      .items(Joi.string().regex(/^[0-9a-fA-F]{24}$/))
      .optional()
      .messages({
        "array.base": "Custom user IDs must be an array",
        "string.pattern.base": "Invalid user ID format",
      }),
  }),
});

/**
 * Validation schema for bulk updating permissions
 */
const bulkUpdatePermissionsSchema = Joi.object({
  permissions: Joi.object()
    .pattern(
      Joi.string().valid(...PERMISSION_KEYS),
      Joi.object({
        accessLevel: Joi.string()
          .valid(...ACCESS_LEVELS)
          .required(),
        customUserIds: Joi.array()
          .items(Joi.string().regex(/^[0-9a-fA-F]{24}$/))
          .default([]),
      })
    )
    .required()
    .messages({
      "object.base": "Permissions must be an object",
      "any.required": "Permissions object is required",
    }),
});

/**
 * Middleware to validate update single permission request
 */
exports.validateUpdateSinglePermission = (req, res, next) => {
  const { error } = updateSinglePermissionSchema.validate(req.body, {
    abortEarly: false,
  });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: errors.join(", "),
    });
  }

  next();
};

/**
 * Middleware to validate bulk update permissions request
 */
exports.validateBulkUpdatePermissions = (req, res, next) => {
  const { error } = bulkUpdatePermissionsSchema.validate(req.body, {
    abortEarly: false,
  });

  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: errors.join(", "),
    });
  }

  next();
};

// Export schemas for reference
exports.updateSinglePermissionSchema = updateSinglePermissionSchema;
exports.bulkUpdatePermissionsSchema = bulkUpdatePermissionsSchema;
exports.PERMISSION_KEYS = PERMISSION_KEYS;
exports.ACCESS_LEVELS = ACCESS_LEVELS;
