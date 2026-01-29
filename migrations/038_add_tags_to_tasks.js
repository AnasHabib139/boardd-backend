const { model } = require("mongoose");

module.exports = {
  name: "038_add_tags_to_tasks",
  version: "1.0.0",
  description: "Add empty tags array to existing tasks that don't have it",

  async up() {
    try {
      console.log("Starting tags migration...");

      const TaskModel = model("Task");

      // Find all tasks that don't have tags field or have null tags
      const tasksWithoutTags = await TaskModel.find({
        $or: [
          { tags: { $exists: false } },
          { tags: null }
        ]
      });

      if (tasksWithoutTags.length === 0) {
        console.log("No tasks found to migrate - all tasks already have tags field");
        return { success: true, message: "No tasks to migrate" };
      }

      console.log(`Found ${tasksWithoutTags.length} tasks to migrate`);

      const batchSize = 500;
      let updatedCount = 0;

      for (let i = 0; i < tasksWithoutTags.length; i += batchSize) {
        const batch = tasksWithoutTags.slice(i, i + batchSize);
        const taskIds = batch.map(task => task._id);

        const result = await TaskModel.updateMany(
          { _id: { $in: taskIds } },
          {
            $set: {
              tags: [],
              updatedAt: new Date()
            }
          }
        );

        updatedCount += result.modifiedCount;
        console.log(`Batch ${Math.floor(i / batchSize) + 1}: Updated ${result.modifiedCount} tasks`);
      }

      console.log(`Migration completed! Updated ${updatedCount} tasks with tags field`);

      return {
        success: true,
        message: `Successfully added tags to ${updatedCount} tasks`
      };
    } catch (error) {
      console.error("Migration failed:", error);
      return {
        success: false,
        message: `Migration failed: ${error.message}`
      };
    }
  },

  async down() {
    try {
      console.log("Rolling back tags migration...");

      const TaskModel = model("Task");

      const result = await TaskModel.updateMany(
        {},
        {
          $unset: { tags: "" },
          $set: { updatedAt: new Date() }
        }
      );

      console.log(`Rollback completed! Removed tags from ${result.modifiedCount} tasks`);

      return {
        success: true,
        message: `Successfully removed tags from ${result.modifiedCount} tasks`
      };
    } catch (error) {
      console.error("Rollback failed:", error);
      return {
        success: false,
        message: `Rollback failed: ${error.message}`
      };
    }
  }
};
