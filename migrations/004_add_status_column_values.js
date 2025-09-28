const { model } = require("mongoose");

module.exports = {
  name: "004_add_status_column_values",
  version: "1.0.0",
  description: "Add statusColumnValues field to existing tasks for project status columns functionality",

  async up() {
    try {
      console.log("🔄 Starting statusColumnValues migration...");

      const TaskModel = model("Task");

      // Find all tasks that don't have statusColumnValues field
      const tasksWithoutField = await TaskModel.find({
        statusColumnValues: { $exists: false }
      });

      if (tasksWithoutField.length === 0) {
        console.log("ℹ️ No tasks found to migrate - all tasks already have statusColumnValues field");
        return { success: true, message: "No tasks to migrate" };
      }

      console.log(`📊 Found ${tasksWithoutField.length} tasks to migrate`);

      const batchSize = 500;
      let updatedCount = 0;

      // Process tasks in batches
      for (let i = 0; i < tasksWithoutField.length; i += batchSize) {
        const batch = tasksWithoutField.slice(i, i + batchSize);
        const taskIds = batch.map(task => task._id);

        // Update batch with empty Map for statusColumnValues
        const result = await TaskModel.updateMany(
          { _id: { $in: taskIds } },
          {
            $set: {
              statusColumnValues: {},
              updatedAt: new Date()
            }
          }
        );

        updatedCount += result.modifiedCount;

        console.log(
          `✅ Batch ${Math.floor(i / batchSize) + 1}: Updated ${result.modifiedCount} tasks`
        );
      }

      console.log(`🎉 Migration completed! Updated ${updatedCount} tasks with statusColumnValues field`);

      return {
        success: true,
        message: `Successfully added statusColumnValues to ${updatedCount} tasks`
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
      console.log("⬇️ Rolling back statusColumnValues migration...");

      const TaskModel = model("Task");

      // Remove statusColumnValues field from all tasks
      const result = await TaskModel.updateMany(
        {},
        {
          $unset: { statusColumnValues: "" },
          $set: { updatedAt: new Date() }
        }
      );

      console.log(
        `✅ Rollback completed! Removed statusColumnValues from ${result.modifiedCount} tasks`
      );

      return {
        success: true,
        message: `Successfully removed statusColumnValues from ${result.modifiedCount} tasks`
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