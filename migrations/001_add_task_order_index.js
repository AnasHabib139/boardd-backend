const { model } = require("mongoose");

module.exports = {
  name: "001_add_task_order_index",
  version: "1.0.0",
  description:
    "Add orderIndex field to existing tasks for drag and drop functionality",

  async up() {
    try {
      console.log("🔄 Starting task orderIndex migration...");

      const TaskModel = model("Task");

      // Get all active tasks grouped by project and status
      const tasks = await TaskModel.find({ isActive: true }).sort({
        projectId: 1,
        status: 1,
        createdAt: 1,
      });

      if (tasks.length === 0) {
        console.log("ℹ️ No tasks found to migrate");
        return { success: true, message: "No tasks to migrate" };
      }

      console.log(`📊 Found ${tasks.length} tasks to migrate`);

      // Group tasks by project and status
      const tasksByProjectAndStatus = {};

      tasks.forEach((task) => {
        const key = `${task.projectId}_${task.status}`;
        if (!tasksByProjectAndStatus[key]) {
          tasksByProjectAndStatus[key] = [];
        }
        tasksByProjectAndStatus[key].push(task);
      });

      let updatedCount = 0;
      const batchSize = 100;
      const updates = [];

      // Process each group and assign order indexes
      for (const [key, groupTasks] of Object.entries(tasksByProjectAndStatus)) {
        const [projectId, status] = key.split("_");

        console.log(
          `📝 Processing ${groupTasks.length} tasks for project ${projectId}, status: ${status}`
        );

        groupTasks.forEach((task, index) => {
          // Calculate orderIndex: start at 1000, increment by 1000
          const orderIndex = (index + 1) * 1000;

          // Prepare orderIndex object for all statuses
          const orderIndexObj = {
            todo: status === "todo" ? orderIndex : 1000,
            in_progress: status === "in_progress" ? orderIndex : 1000,
            completed: status === "completed" ? orderIndex : 1000,
          };

          updates.push({
            updateOne: {
              filter: { _id: task._id },
              update: {
                $set: {
                  orderIndex: orderIndexObj,
                  updatedAt: new Date(),
                },
              },
            },
          });
        });
      }

      // Execute updates in batches
      console.log(
        `🚀 Executing ${updates.length} updates in batches of ${batchSize}...`
      );

      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        const result = await TaskModel.bulkWrite(batch);
        updatedCount += result.modifiedCount;

        console.log(
          `✅ Batch ${Math.floor(i / batchSize) + 1}: Updated ${
            result.modifiedCount
          } tasks`
        );
      }

      console.log(`🎉 Migration completed! Updated ${updatedCount} tasks`);

      return {
        success: true,
        message: `Successfully added orderIndex to ${updatedCount} tasks`,
      };
    } catch (error) {
      console.error("❌ Migration failed:", error);
      return {
        success: false,
        message: `Migration failed: ${error.message}`,
      };
    }
  },

  async down() {
    try {
      console.log("⬇️ Rolling back task orderIndex migration...");

      const TaskModel = model("Task");

      // Remove orderIndex field from all tasks
      const result = await TaskModel.updateMany(
        {},
        {
          $unset: { orderIndex: "" },
          $set: { updatedAt: new Date() },
        }
      );

      console.log(
        `✅ Rollback completed! Removed orderIndex from ${result.modifiedCount} tasks`
      );

      return {
        success: true,
        message: `Successfully removed orderIndex from ${result.modifiedCount} tasks`,
      };
    } catch (error) {
      console.error("❌ Rollback failed:", error);
      return {
        success: false,
        message: `Rollback failed: ${error.message}`,
      };
    }
  },
};
