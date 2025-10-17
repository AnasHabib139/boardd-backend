const { model } = require("mongoose");

module.exports = {
  name: "007_update_task_attachments_structure",
  version: "1.0.0",
  description: "Transform task attachments from simple string URLs to objects with metadata (url, fileName, fileSize, mimeType, uploadedBy, uploadedAt)",

  async up() {
    try {
      console.log("🔄 Starting task attachments structure migration...");

      const TaskModel = model("Task");

      // Find all tasks that have attachments (old string format or already migrated)
      const tasksWithAttachments = await TaskModel.find({
        attachments: { $exists: true, $ne: [] }
      });

      if (tasksWithAttachments.length === 0) {
        console.log("ℹ️ No tasks found with attachments to migrate");
        return { success: true, message: "No tasks to migrate" };
      }

      console.log(`📊 Found ${tasksWithAttachments.length} tasks with attachments`);

      let migratedCount = 0;
      let alreadyMigratedCount = 0;

      // Helper function to extract filename from URL
      const extractFileName = (url) => {
        try {
          const urlObj = new URL(url);
          const pathname = urlObj.pathname;
          const filename = pathname.split('/').pop() || 'unknown';
          return decodeURIComponent(filename);
        } catch (error) {
          return 'attachment';
        }
      };

      // Process each task individually
      for (const task of tasksWithAttachments) {
        try {
          // Check if attachments are already in new format (has 'url' property)
          const firstAttachment = task.attachments[0];

          // If already an object with 'url', skip this task
          if (firstAttachment && typeof firstAttachment === 'object' && firstAttachment.url) {
            alreadyMigratedCount++;
            continue;
          }

          // Transform string attachments to object format
          const transformedAttachments = task.attachments.map((attachment) => {
            // If it's already an object (shouldn't happen but defensive coding)
            if (typeof attachment === 'object') {
              return attachment;
            }

            // Transform string URL to object
            const url = attachment;
            return {
              url: url,
              fileName: extractFileName(url),
              fileSize: null, // No data available
              mimeType: null, // No data available
              uploadedBy: task.createdBy, // Use task creator as uploader
              uploadedAt: task.createdAt || new Date() // Use task creation date
            };
          });

          // Update the task with transformed attachments
          await TaskModel.updateOne(
            { _id: task._id },
            {
              $set: {
                attachments: transformedAttachments,
                updatedAt: new Date()
              }
            }
          );

          migratedCount++;

          if (migratedCount % 100 === 0) {
            console.log(`✅ Progress: Migrated ${migratedCount} tasks...`);
          }
        } catch (taskError) {
          console.error(`⚠️ Failed to migrate task ${task._id}:`, taskError.message);
          // Continue with next task
        }
      }

      console.log(`🎉 Migration completed!`);
      console.log(`   - Migrated: ${migratedCount} tasks`);
      console.log(`   - Already migrated: ${alreadyMigratedCount} tasks`);
      console.log(`   - Total processed: ${tasksWithAttachments.length} tasks`);

      return {
        success: true,
        message: `Successfully migrated ${migratedCount} tasks, ${alreadyMigratedCount} were already migrated`
      };
    } catch (error) {
      console.error("❌ Migration failed:", error);
      return {
        success: false,
        message: `Migration failed: ${error.message}`
      };
    }
  },

  async down() {
    try {
      console.log("⬇️ Rolling back task attachments structure migration...");

      const TaskModel = model("Task");

      // Find all tasks with object-format attachments
      const tasksWithObjectAttachments = await TaskModel.find({
        "attachments.0.url": { $exists: true }
      });

      if (tasksWithObjectAttachments.length === 0) {
        console.log("ℹ️ No tasks found to rollback");
        return { success: true, message: "No tasks to rollback" };
      }

      console.log(`📊 Found ${tasksWithObjectAttachments.length} tasks to rollback`);

      let rolledBackCount = 0;

      // Process each task individually
      for (const task of tasksWithObjectAttachments) {
        try {
          // Transform object attachments back to simple URL strings
          const stringAttachments = task.attachments.map((attachment) => {
            // If it's already a string, keep it
            if (typeof attachment === 'string') {
              return attachment;
            }
            // Extract URL from object
            return attachment.url;
          });

          // Update the task with string attachments
          await TaskModel.updateOne(
            { _id: task._id },
            {
              $set: {
                attachments: stringAttachments,
                updatedAt: new Date()
              }
            }
          );

          rolledBackCount++;

          if (rolledBackCount % 100 === 0) {
            console.log(`✅ Progress: Rolled back ${rolledBackCount} tasks...`);
          }
        } catch (taskError) {
          console.error(`⚠️ Failed to rollback task ${task._id}:`, taskError.message);
          // Continue with next task
        }
      }

      console.log(`✅ Rollback completed! Rolled back ${rolledBackCount} tasks`);

      return {
        success: true,
        message: `Successfully rolled back ${rolledBackCount} tasks`
      };
    } catch (error) {
      console.error("❌ Rollback failed:", error);
      return {
        success: false,
        message: `Rollback failed: ${error.message}`
      };
    }
  }
};
