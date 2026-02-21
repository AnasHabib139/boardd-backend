const { model } = require("mongoose");

module.exports = {
  name: "040_add_task_fields_to_subtasks",
  version: "1.0.0",
  description:
    "Add task-matching fields to existing subtasks and populate companyId from parent task",

  async up() {
    try {
      console.log("Starting subtask fields migration...");

      const SubtaskModel = model("Subtask");
      const TaskModel = model("Task");

      // Phase 1: Set default values for all new simple fields
      const defaultFieldsResult = await SubtaskModel.updateMany(
        { description: { $exists: false } },
        {
          $set: {
            description: "",
            status: "todo",
            priority: "medium",
            tags: [],
            strokeColor: "#6C63FF",
            type: "task",
            attachments: [],
            links: [],
            customFields: [],
            checklist: [],
            orderIndex: { todo: 1000 },
            updatedAt: new Date(),
          },
        }
      );
      console.log(
        `Phase 1: Set default fields on ${defaultFieldsResult.modifiedCount} subtasks`
      );

      // Phase 2: Sync isCompleted -> status for existing completed subtasks
      const completedResult = await SubtaskModel.updateMany(
        {
          isCompleted: true,
          $or: [{ status: { $exists: false } }, { status: "todo" }],
        },
        { $set: { status: "completed" } }
      );
      console.log(
        `Phase 2: Synced status for ${completedResult.modifiedCount} completed subtasks`
      );

      // Phase 3: Populate companyId from parent task (batch processing)
      const subtasksWithoutCompany = await SubtaskModel.find({
        $or: [{ companyId: { $exists: false } }, { companyId: null }],
      }).select("_id taskId");

      console.log(
        `Phase 3: Found ${subtasksWithoutCompany.length} subtasks needing companyId`
      );

      const batchSize = 500;
      let updatedCount = 0;

      for (let i = 0; i < subtasksWithoutCompany.length; i += batchSize) {
        const batch = subtasksWithoutCompany.slice(i, i + batchSize);

        // Get unique taskIds for this batch
        const taskIds = [
          ...new Set(batch.map((s) => s.taskId.toString())),
        ].map((id) => id);
        const tasks = await TaskModel.find({
          _id: { $in: taskIds },
        }).select("_id companyId");

        const taskCompanyMap = {};
        tasks.forEach((t) => {
          taskCompanyMap[t._id.toString()] = t.companyId;
        });

        // Update each subtask in the batch
        const bulkOps = batch
          .filter((s) => taskCompanyMap[s.taskId.toString()])
          .map((s) => ({
            updateOne: {
              filter: { _id: s._id },
              update: {
                $set: { companyId: taskCompanyMap[s.taskId.toString()] },
              },
            },
          }));

        if (bulkOps.length > 0) {
          const result = await SubtaskModel.bulkWrite(bulkOps);
          updatedCount += result.modifiedCount;
        }

        console.log(
          `Phase 3 batch ${Math.floor(i / batchSize) + 1}: processed ${batch.length} subtasks`
        );
      }

      console.log(`Phase 3: Populated companyId for ${updatedCount} subtasks`);

      console.log("Migration completed successfully!");

      return {
        success: true,
        message: `Migration complete. Default fields: ${defaultFieldsResult.modifiedCount}, Status synced: ${completedResult.modifiedCount}, CompanyId populated: ${updatedCount}`,
      };
    } catch (error) {
      console.error("Migration failed:", error);
      return {
        success: false,
        message: `Migration failed: ${error.message}`,
      };
    }
  },

  async down() {
    try {
      console.log("Rolling back subtask fields migration...");

      const SubtaskModel = model("Subtask");

      const result = await SubtaskModel.updateMany(
        {},
        {
          $unset: {
            description: "",
            status: "",
            priority: "",
            dueDate: "",
            tags: "",
            strokeColor: "",
            type: "",
            attachments: "",
            links: "",
            customFields: "",
            checklist: "",
            companyId: "",
            orderIndex: "",
          },
          $set: { updatedAt: new Date() },
        }
      );

      console.log(
        `Rollback: Removed fields from ${result.modifiedCount} subtasks`
      );

      return {
        success: true,
        message: `Rolled back ${result.modifiedCount} subtasks`,
      };
    } catch (error) {
      console.error("Rollback failed:", error);
      return {
        success: false,
        message: `Rollback failed: ${error.message}`,
      };
    }
  },
};
