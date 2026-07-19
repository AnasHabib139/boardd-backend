"use strict";

const { model } = require("mongoose");

module.exports = {
  name: "050_backfill_status_closing_flags",
  version: "1.0.0",
  description:
    "Backfill isCompletedStatus on TabTaskStatus and isClosingStatus/isCompleted on Task/Subtask from the literal 'completed' statusKey",

  async up() {
    try {
      console.log("Starting status-closing-flag backfill...");

      const TabTaskStatusModel = model("TabTaskStatus");
      const TaskModel = model("Task");
      const SubtaskModel = model("Subtask");

      // Phase 1: TabTaskStatus — flag every existing "completed" system status
      const statusResult = await TabTaskStatusModel.updateMany(
        { statusKey: "completed" },
        { $set: { isCompletedStatus: true, updatedAt: new Date() } }
      );
      console.log(`Phase 1: Flagged ${statusResult.modifiedCount} "completed" statuses`);

      // Phase 2: Task — backfill isClosingStatus from current literal status
      const taskResult = await TaskModel.updateMany(
        { status: "completed" },
        { $set: { isClosingStatus: true, updatedAt: new Date() } }
      );
      console.log(`Phase 2: Flagged ${taskResult.modifiedCount} completed tasks`);

      // Phase 3: Subtask — same, onto the existing isCompleted field
      const subtaskResult = await SubtaskModel.updateMany(
        { status: "completed", isCompleted: { $ne: true } },
        { $set: { isCompleted: true, updatedAt: new Date() } }
      );
      console.log(`Phase 3: Flagged ${subtaskResult.modifiedCount} completed subtasks`);

      return {
        success: true,
        message: `Flagged ${statusResult.modifiedCount} statuses, ${taskResult.modifiedCount} tasks, ${subtaskResult.modifiedCount} subtasks`,
      };
    } catch (error) {
      console.error("Migration failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    try {
      console.log("Rolling back status-closing-flag backfill...");

      const TabTaskStatusModel = model("TabTaskStatus");
      const TaskModel = model("Task");

      const statusResult = await TabTaskStatusModel.updateMany({}, { $unset: { isCompletedStatus: "" } });
      const taskResult = await TaskModel.updateMany({}, { $unset: { isClosingStatus: "" } });
      // Subtask.isCompleted pre-existed this feature — down() does NOT touch
      // it, only the newly-added TabTaskStatus/Task fields are reversed.

      console.log(
        `Rollback: Removed isCompletedStatus from ${statusResult.modifiedCount} statuses, isClosingStatus from ${taskResult.modifiedCount} tasks`
      );

      return {
        success: true,
        message: `Rolled back ${statusResult.modifiedCount} statuses, ${taskResult.modifiedCount} tasks`,
      };
    } catch (error) {
      console.error("Rollback failed:", error);
      return { success: false, message: `Rollback failed: ${error.message}` };
    }
  },
};
