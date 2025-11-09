const { Schema, model, Types } = require("mongoose");

/**
 * Permission Policy Model
 * Defines company-wide permissions for features and actions
 *
 * Access Levels:
 * - "all": Everyone (admins, members, guests)
 * - "admins": Only company admins
 * - "members": Admins and members (excludes guests)
 * - "custom": Specific users selected by admin (stored in customUserIds)
 */

// Individual permission sub-schema
const permissionSchema = new Schema({
  accessLevel: {
    type: String,
    enum: ["all", "admins", "members", "custom"],
    default: "admins",
  },
  customUserIds: [{
    type: Types.ObjectId,
    ref: "User",
  }],
}, { _id: false });

const CompanyPermissionPolicySchema = new Schema(
  {
    companyId: {
      type: Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
      index: true,
    },

    // ==================== ACCOUNT AND CHANNELS ====================

    // Account Permissions
    inviteNonAuthorizedDomains: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    inviteGuests: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    uploadFiles: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    deleteFiles: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },
    createChannels: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    mentionEveryone: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    createAutomations: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    editSchedules: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },

    // Channel Permissions
    createPrivateChannels: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    createShareableChannels: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },
    deleteSelfOwnedChannels: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    deleteOthersChannels: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    moveGroupsToWorkspace: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },

    // ==================== FORMS, DOCUMENTS AND DASHBOARD ====================

    // Forms and Documents Permissions
    createForms: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },
    createDocuments: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    deleteSelfForms: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    deleteSelfDocuments: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },

    // Dashboard Permissions
    editDashboardTabs: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },
    deleteDashboardTabs: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },

    // ==================== USER MANAGEMENT AND COMMUNICATION ====================

    // User Management Permissions
    deleteUserOwnedContent: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    editTeamNameImage: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },
    addRemoveChannelMembers: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },
    manageAllMembers: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    viewTeamManagement: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    uploadProfilePicture: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },

    // Communication Permissions
    muteAllNotifications: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    editSelfOwnedItems: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    deleteSelfOwnedItems: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    makeComments: { type: permissionSchema, default: () => ({ accessLevel: "all" }) },
    editDeleteComments: { type: permissionSchema, default: () => ({ accessLevel: "members" }) },

    // ==================== ADMIN PRIVILEGES ====================

    viewPermissions: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    accessUserManagement: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    accessSecurity: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    accessBilling: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
    accessClientPayments: { type: permissionSchema, default: () => ({ accessLevel: "admins" }) },
  },
  { timestamps: true }
);

// Index for efficient company lookups
CompanyPermissionPolicySchema.index({ companyId: 1 });

const CompanyPermissionPolicyModel = model("CompanyPermissionPolicy", CompanyPermissionPolicySchema);

/**
 * Create a new permission policy for a company
 * @param {ObjectId} companyId
 * @returns {Promise<CompanyPermissionPolicy>}
 */
exports.createPermissionPolicy = async (companyId) => {
  return CompanyPermissionPolicyModel.create({ companyId });
};

/**
 * Find permission policy by company ID
 * @param {ObjectId} companyId
 * @returns {Promise<CompanyPermissionPolicy>}
 */
exports.findPermissionPolicy = (companyId) => {
  return CompanyPermissionPolicyModel.findOne({ companyId });
};

/**
 * Update a specific permission
 * @param {ObjectId} companyId
 * @param {String} permissionKey
 * @param {String} accessLevel
 * @param {Array<ObjectId>} customUserIds
 * @returns {Promise<CompanyPermissionPolicy>}
 */
exports.updatePermission = async (companyId, permissionKey, accessLevel, customUserIds = []) => {
  const updateObj = {
    [`${permissionKey}.accessLevel`]: accessLevel,
    [`${permissionKey}.customUserIds`]: customUserIds,
  };

  return CompanyPermissionPolicyModel.findOneAndUpdate(
    { companyId },
    { $set: updateObj },
    { new: true }
  );
};

/**
 * Bulk update multiple permissions
 * @param {ObjectId} companyId
 * @param {Object} permissions - { permissionKey: { accessLevel, customUserIds }, ... }
 * @returns {Promise<CompanyPermissionPolicy>}
 */
exports.bulkUpdatePermissions = async (companyId, permissions) => {
  const updateObj = {};

  Object.keys(permissions).forEach((permissionKey) => {
    const { accessLevel, customUserIds } = permissions[permissionKey];
    updateObj[`${permissionKey}.accessLevel`] = accessLevel;
    updateObj[`${permissionKey}.customUserIds`] = customUserIds || [];
  });

  return CompanyPermissionPolicyModel.findOneAndUpdate(
    { companyId },
    { $set: updateObj },
    { new: true }
  );
};

/**
 * Check if a user has a specific permission
 * @param {ObjectId} companyId
 * @param {ObjectId} userId
 * @param {String} userRole - 'admin', 'member', 'guest'
 * @param {String} permissionKey
 * @returns {Promise<Boolean>}
 */
exports.hasPermission = async (companyId, userId, userRole, permissionKey) => {
  const policy = await CompanyPermissionPolicyModel.findOne({ companyId });

  if (!policy) {
    // No policy exists, default to admins only
    return userRole === "admin";
  }

  const permission = policy[permissionKey];

  if (!permission) {
    // Permission key doesn't exist, deny by default
    return false;
  }

  switch (permission.accessLevel) {
    case "all":
      return true;

    case "admins":
      return userRole === "admin";

    case "members":
      return userRole === "admin" || userRole === "member";

    case "custom":
      // Admins always have access, plus custom users
      return userRole === "admin" || permission.customUserIds.some(id => id.toString() === userId.toString());

    default:
      return false;
  }
};

/**
 * Get all permission keys grouped by category
 * @returns {Object} Permission keys organized by tab
 */
exports.getPermissionCategories = () => {
  return {
    accountAndChannels: {
      accounts: [
        "inviteNonAuthorizedDomains",
        "inviteGuests",
        "uploadFiles",
        "deleteFiles",
        "createChannels",
        "mentionEveryone",
        "createAutomations",
        "editSchedules"
      ],
      channels: [
        "createPrivateChannels",
        "createShareableChannels",
        "deleteSelfOwnedChannels",
        "deleteOthersChannels",
        "moveGroupsToWorkspace"
      ]
    },
    formsDocumentsDashboard: {
      formsDocuments: [
        "createForms",
        "createDocuments",
        "deleteSelfForms",
        "deleteSelfDocuments"
      ],
      dashboard: [
        "editDashboardTabs",
        "deleteDashboardTabs"
      ]
    },
    userManagementCommunication: {
      userManagement: [
        "deleteUserOwnedContent",
        "editTeamNameImage",
        "addRemoveChannelMembers",
        "manageAllMembers",
        "viewTeamManagement",
        "uploadProfilePicture"
      ],
      communication: [
        "muteAllNotifications",
        "editSelfOwnedItems",
        "deleteSelfOwnedItems",
        "makeComments",
        "editDeleteComments"
      ]
    },
    adminPrivileges: [
      "viewPermissions",
      "accessUserManagement",
      "accessSecurity",
      "accessBilling",
      "accessClientPayments"
    ]
  };
};

exports.CompanyPermissionPolicyModel = CompanyPermissionPolicyModel;
