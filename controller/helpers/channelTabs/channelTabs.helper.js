const { DEFAULT_TABS, ROLES } = require("../../../utils/constants");
const { findManyUsers } = require("../../../models/userModel");

/**
 * Get all company admins and merge with existing members (avoiding duplicates)
 */
exports.getAdminsAndMergeMembers = async (companyId, existingMembers = []) => {
  try {
    // Find all admin users in the company
    const companyAdmins = await findManyUsers({
      companyId,
      role: ROLES.ADMIN,
      isActive: true,
    });

    // Extract admin IDs
    const adminIds = companyAdmins.map((admin) => admin._id.toString());

    // Convert existing members to strings for comparison
    const existingMemberStrings = existingMembers.map((id) => id.toString());

    // Merge and remove duplicates
    const uniqueMembers = [...new Set([...existingMemberStrings, ...adminIds])];
    console.log("uniqueMembers", uniqueMembers);
    return uniqueMembers;
  } catch (error) {
    console.error("Error getting admins and merging members:", error);
    // Return existing members if error occurs
    return existingMembers.map((id) => id.toString());
  }
};

exports.createDefaultTabs = async (channelId, userId, companyId) => {
  // Get all admins and merge with creator
  const allMembers = await exports.getAdminsAndMergeMembers(companyId, [
    userId,
  ]);

  return [
    {
      channelId: channelId,
      tabName: DEFAULT_TABS.CLIENT_MANAGEMENT,
      isDefault: true,
      members: allMembers,
      createdBy: userId,
      companyId: companyId,
      isPrivate: true,
    },
    {
      channelId: channelId,
      tabName: DEFAULT_TABS.TASK_MANAGEMENT,
      isDefault: true,
      members: allMembers,
      createdBy: userId,
      companyId: companyId,
      isPrivate: false,
    },
    {
      channelId: channelId,
      tabName: DEFAULT_TABS.WORK_IN_PROGRESS,
      isDefault: true,
      members: allMembers,
      createdBy: userId,
      companyId: companyId,
      isPrivate: false,
    },
    {
      channelId: channelId,
      tabName: DEFAULT_TABS.FORM_BUILDER,
      isDefault: true,
      members: allMembers,
      createdBy: userId,
      companyId: companyId,
      isPrivate: false,
    },
  ];
};
