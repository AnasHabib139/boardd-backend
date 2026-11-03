"use strict";

const { Types } = require("mongoose");
const { TaskModel } = require("../models/taskModel");
const { findManyProjects } = require("../models/projectModel");
const { TabTaskStatus } = require("../models/tabTaskStatusModel");
const { purgeTasks } = require("../controller/helpers/tasks/task.helper");

module.exports = {
  name: "053_fix_project_task_integrity",
  version: "1.0.0",
  description:
    "Hard-delete tasks (and their cascade) orphaned by hard-deleted projects, and backfill channelId on project tasks nulled by moveTaskToProject",

  async up() {
    try {
      // 1. Orphans: tasks/statuses pointing at a project that no longer exists
      //    (deleteProjectById used to delete only the project document)
      const referencedIds = [
        ...(await TaskModel.distinct("projectId", { projectId: { $ne: null } })),
        ...(await TabTaskStatus.distinct("projectId", { projectId: { $ne: null } })),
      ];
      const existing = new Set(
        (await findManyProjects({ _id: { $in: referencedIds } }).select("_id").lean()).map((p) => String(p._id))
      );
      const orphanIds = [...new Set(referencedIds.map(String))]
        .filter((id) => !existing.has(id))
        .map((id) => new Types.ObjectId(id));

      let purged = 0;
      if (orphanIds.length) {
        const orphanTasks = await TaskModel.find({ projectId: { $in: orphanIds } }, { _id: 1, attachments: 1 }).lean();
        await purgeTasks(orphanTasks);
        await TabTaskStatus.deleteMany({ projectId: { $in: orphanIds } });
        purged = orphanTasks.length;
      }

      // 2. Backfill channelId on project tasks: moveTaskToProject used to null it,
      //    hiding them from channel-scoped queries (dropdown, channel files, connection search)
      const nullChannelProjectIds = await TaskModel.distinct("projectId", {
        projectId: { $ne: null },
        channelId: null,
      });
      const projects = await findManyProjects(
        { _id: { $in: nullChannelProjectIds }, channelId: { $ne: null } }
      ).select("channelId").lean();
      let backfilled = 0;
      if (projects.length) {
        const result = await TaskModel.bulkWrite(
          projects.map((p) => ({
            updateMany: {
              filter: { projectId: p._id, channelId: null },
              update: { $set: { channelId: p.channelId } },
            },
          }))
        );
        backfilled = result.modifiedCount;
      }

      const message = `Purged ${purged} orphaned tasks across ${orphanIds.length} deleted projects; backfilled channelId on ${backfilled} project tasks`;
      console.log(message);
      return { success: true, message };
    } catch (error) {
      console.error("Migration failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    return { success: true, message: "No-op: deleted orphaned tasks cannot be restored" };
  },
};
