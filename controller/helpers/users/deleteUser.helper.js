const { Types } = require("mongoose");

// Import required model functions
const { findCompany } = require("../../../models/companyModel");

/**
 * Comprehensive user cleanup strategy
 */
exports.cleanupUserReferences = async (userId, companyId) => {
  const userObjectId = new Types.ObjectId(userId);
  const cleanupResults = {
    ownership: {},
    assignments: {},
    personalData: {},
    errors: []
  };

  try {
    console.log(`🧹 Starting comprehensive cleanup for user: ${userId}`);

    // 1. HANDLE OWNERSHIP REFERENCES
    await handleOwnershipReferences(userObjectId, companyId, cleanupResults);

    // 2. HANDLE ASSIGNMENT/MEMBERSHIP REFERENCES  
    await handleAssignmentReferences(userObjectId, companyId, cleanupResults);

    // 3. HANDLE PERSONAL DATA REFERENCES (DELETE)
    await handlePersonalDataReferences(userObjectId, companyId, cleanupResults);

    console.log(`✅ User cleanup completed successfully`);
    return cleanupResults;

  } catch (error) {
    console.error("❌ Error during user cleanup:", error);
    cleanupResults.errors.push({
      operation: "general",
      error: error.message
    });
    throw error;
  }
};

/**
 * Handle ownership references - user created something
 * Strategy: Reassign to admin or mark as system/deleted
 */
async function handleOwnershipReferences(userId, companyId, results) {
  try {
    console.log("🔧 Handling ownership references...");
    const mongoose = require("mongoose");

    // Find company admin to reassign ownership
    const company = await findCompany({ _id: companyId });
    const adminUserId = company?.adminUser;

    // Check if user being deleted IS the admin
    if (adminUserId?.toString() === userId.toString()) {
      throw new Error("Cannot delete company admin. Transfer admin rights first.");
    }

    // Get models dynamically to avoid import issues
    const ChannelModel = mongoose.model("Channel");
    const ChannelTabModel = mongoose.model("ChannelTab");
    const ProjectModel = mongoose.model("Project");
    const TaskModel = mongoose.model("Task");
    const SubtaskModel = mongoose.model("Subtask");
    const FormModel = mongoose.model("Form");
    const TeamCardModel = mongoose.model("TeamCard");
    const NotificationModel = mongoose.model("Notification");

    // 1. Channels created by user -> reassign to admin
    const channelUpdateResult = await ChannelModel.updateMany(
      { createdBy: userId, companyId: companyId },
      { createdBy: adminUserId }
    );
    results.ownership.channels = channelUpdateResult.modifiedCount;

    // 2. Channel Tabs -> reassign to admin
    const tabUpdateResult = await ChannelTabModel.updateMany(
      { createdBy: userId, companyId: companyId },
      { createdBy: adminUserId }
    );
    results.ownership.channelTabs = tabUpdateResult.modifiedCount;

    // 3. Projects -> reassign to admin
    const projectUpdateResult = await ProjectModel.updateMany(
      { createdBy: userId, companyId: companyId },
      { createdBy: adminUserId }
    );
    results.ownership.projects = projectUpdateResult.modifiedCount;

    // 4. Tasks -> reassign to admin 
    const taskUpdateResult = await TaskModel.updateMany(
      { createdBy: userId, companyId: companyId },
      { createdBy: adminUserId }
    );
    results.ownership.tasks = taskUpdateResult.modifiedCount;

    // 5. Subtasks -> reassign to admin
    const subtaskUpdateResult = await SubtaskModel.updateMany(
      { createdBy: userId, companyId: companyId },
      { createdBy: adminUserId }
    );
    results.ownership.subtasks = subtaskUpdateResult.modifiedCount;

    // 6. Forms -> reassign to admin
    const formUpdateResult = await FormModel.updateMany(
      { createdBy: userId, companyId: companyId },
      { createdBy: adminUserId }
    );
    results.ownership.forms = formUpdateResult.modifiedCount;

    // 7. Team Cards -> reassign to admin
    const teamCardUpdateResult = await TeamCardModel.updateMany(
      { createdBy: userId, companyId: companyId },
      { createdBy: adminUserId }
    );
    results.ownership.teamCards = teamCardUpdateResult.modifiedCount;

    // 8. Notifications created by user -> reassign to admin
    const notificationUpdateResult = await NotificationModel.updateMany(
      { createdBy: userId },
      { createdBy: adminUserId }
    );
    results.ownership.notifications = notificationUpdateResult.modifiedCount;

    console.log(`✅ Ownership references handled: ${JSON.stringify(results.ownership)}`);

  } catch (error) {
    console.error("❌ Error handling ownership references:", error);
    results.errors.push({
      operation: "ownership",
      error: error.message
    });
    throw error;
  }
}

/**
 * Handle assignment/membership references
 * Strategy: Remove user from arrays
 */
async function handleAssignmentReferences(userId, companyId, results) {
  try {
    console.log("👥 Handling assignment/membership references...");
    const mongoose = require("mongoose");

    // Get models dynamically to avoid import issues
    const ChannelModel = mongoose.model("Channel");
    const ChannelTabModel = mongoose.model("ChannelTab");
    const TaskModel = mongoose.model("Task");
    const SubtaskModel = mongoose.model("Subtask");
    const TeamCardModel = mongoose.model("TeamCard");

    // 1. Remove from channel members
    const channelUpdateResult = await ChannelModel.updateMany(
      { 
        companyId: companyId,
        members: userId 
      },
      { 
        $pull: { members: userId } 
      }
    );
    results.assignments.channelMemberships = channelUpdateResult.modifiedCount;

    // 2. Remove from channel tab members
    const tabUpdateResult = await ChannelTabModel.updateMany(
      { 
        companyId: companyId,
        members: userId 
      },
      { 
        $pull: { members: userId } 
      }
    );
    results.assignments.tabMemberships = tabUpdateResult.modifiedCount;

    // 3. Remove from task assignments
    const taskUpdateResult = await TaskModel.updateMany(
      { 
        companyId: companyId,
        assignedTo: userId 
      },
      { 
        $pull: { assignedTo: userId } 
      }
    );
    results.assignments.taskAssignments = taskUpdateResult.modifiedCount;

    // 4. Remove from subtask assignments
    const subtaskUpdateResult = await SubtaskModel.updateMany(
      { 
        companyId: companyId,
        assignedTo: userId 
      },
      { 
        $pull: { assignedTo: userId } 
      }
    );
    results.assignments.subtaskAssignments = subtaskUpdateResult.modifiedCount;

    // 5. Remove from team card members (nested array)
    const teamCardUpdateResult = await TeamCardModel.updateMany(
      { 
        companyId: companyId,
        "members.userId": userId 
      },
      { 
        $pull: { members: { userId: userId } } 
      }
    );
    results.assignments.teamCardMemberships = teamCardUpdateResult.modifiedCount;

    console.log(`✅ Assignment references handled: ${JSON.stringify(results.assignments)}`);

  } catch (error) {
    console.error("❌ Error handling assignment references:", error);
    results.errors.push({
      operation: "assignments",
      error: error.message
    });
    throw error;
  }
}

/**
 * Handle personal data references
 * Strategy: Delete all personal data
 */
async function handlePersonalDataReferences(userId, companyId, results) {
  try {
    console.log("🗑️ Handling personal data references...");
    const mongoose = require("mongoose");

    // Get models dynamically to avoid import issues
    const NotificationModel = mongoose.model("Notification");
    const ActivityModel = mongoose.model("Activity");
    const FormViewModel = mongoose.model("FormView");
    const FavoriteModel = mongoose.model("FormFavorite");

    // 1. Delete user notifications
    const notificationDeleteResult = await NotificationModel.deleteMany({
      userId: userId
    });
    results.personalData.notifications = notificationDeleteResult.deletedCount;

    // 2. Delete user activities  
    const activityDeleteResult = await ActivityModel.deleteMany({
      userId: userId
    });
    results.personalData.activities = activityDeleteResult.deletedCount;

    // 3. Delete user form views
    const formViewDeleteResult = await FormViewModel.deleteMany({
      userId: userId
    });
    results.personalData.formViews = formViewDeleteResult.deletedCount;

    // 4. Delete user favorites
    const favoriteDeleteResult = await FavoriteModel.deleteMany({
      userId: userId
    });
    results.personalData.favorites = favoriteDeleteResult.deletedCount;

    console.log(`✅ Personal data references handled: ${JSON.stringify(results.personalData)}`);

  } catch (error) {
    console.error("❌ Error handling personal data references:", error);
    results.errors.push({
      operation: "personalData", 
      error: error.message
    });
    throw error;
  }
}