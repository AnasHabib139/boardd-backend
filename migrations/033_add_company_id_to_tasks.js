const mongoose = require("mongoose");

module.exports = {
  name: "033_add_company_id_to_tasks",
  version: 33,
  description: "Add companyId field to tasks collection and populate from channels",

  async up() {
    const db = mongoose.connection.db;

    try {
      console.log("Starting migration: Add companyId to tasks...");

      // Get all tasks that don't have companyId set
      const tasksToUpdate = await db.collection("tasks").find({
        companyId: { $exists: false }
      }).toArray();

      console.log(`Found ${tasksToUpdate.length} tasks to update`);

      let updatedCount = 0;
      let failedCount = 0;

      // Update each task with companyId from its channel
      for (const task of tasksToUpdate) {
        try {
          // Lookup the channel to get companyId
          const channel = await db.collection("channels").findOne({
            _id: task.channelId
          });

          if (channel && channel.companyId) {
            // Update task with companyId from channel
            await db.collection("tasks").updateOne(
              { _id: task._id },
              { $set: { companyId: channel.companyId } }
            );
            updatedCount++;
          } else {
            console.warn(`⚠ Task ${task._id} has no valid channel or channel.companyId`);
            failedCount++;
          }
        } catch (error) {
          console.error(`✗ Error updating task ${task._id}:`, error.message);
          failedCount++;
        }
      }

      // Create index on companyId for better query performance (if doesn't exist)
      try {
        await db.collection("tasks").createIndex(
          { companyId: 1 },
          { name: "task_companyId_index", background: true }
        );
        console.log("✓ Created index on tasks.companyId");
      } catch (indexError) {
        // Index might already exist from schema definition
        console.log("⚠ Index on companyId may already exist, continuing...");
      }

      console.log(`✓ Updated ${updatedCount} tasks with companyId`);
      if (failedCount > 0) {
        console.log(`⚠ Failed to update ${failedCount} tasks`);
      }

      return {
        success: true,
        message: `Successfully added companyId to ${updatedCount} tasks (${failedCount} failed)`
      };
    } catch (error) {
      console.error("✗ Error in migration:", error.message);
      throw error;
    }
  },

  async down() {
    const db = mongoose.connection.db;

    try {
      console.log("Rolling back: Remove companyId from tasks...");

      // Drop the index
      try {
        await db.collection("tasks").dropIndex("task_companyId_index");
        console.log("✓ Dropped companyId index");
      } catch (error) {
        console.log("⚠ Index may not exist, continuing...");
      }

      // Remove companyId field from all tasks
      const result = await db.collection("tasks").updateMany(
        {},
        { $unset: { companyId: "" } }
      );

      console.log(`✓ Removed companyId from ${result.modifiedCount} tasks`);

      return {
        success: true,
        message: `Successfully removed companyId from tasks`
      };
    } catch (error) {
      console.error("✗ Error rolling back migration:", error.message);
      throw error;
    }
  }
};
