const { model } = require("mongoose");

module.exports = {
  name: "039_add_order_index_to_projects",
  version: "1.0.0",
  description: "Add orderIndex field to existing projects for drag-and-drop reordering",

  async up() {
    try {
      console.log("Starting project orderIndex migration...");

      const ProjectModel = model("Project");

      // Get all active projects sorted by tabId, then isPinned, then createdAt
      // This preserves the current visual order when assigning orderIndex values
      const projects = await ProjectModel.find({ status: "active" })
        .sort({ tabId: 1, isPinned: -1, createdAt: -1 });

      if (projects.length === 0) {
        console.log("No projects found to migrate");
        return { success: true, message: "No projects to migrate" };
      }

      console.log(`Found ${projects.length} projects to migrate`);

      // Group projects by tabId
      const projectsByTab = {};
      for (const project of projects) {
        const tabKey = project.tabId.toString();
        if (!projectsByTab[tabKey]) {
          projectsByTab[tabKey] = [];
        }
        projectsByTab[tabKey].push(project);
      }

      // Assign orderIndex per tab (1000, 2000, 3000...)
      const bulkOps = [];
      for (const tabId of Object.keys(projectsByTab)) {
        const tabProjects = projectsByTab[tabId];
        tabProjects.forEach((project, index) => {
          bulkOps.push({
            updateOne: {
              filter: { _id: project._id },
              update: {
                $set: {
                  orderIndex: (index + 1) * 1000,
                  updatedAt: new Date(),
                },
              },
            },
          });
        });
      }

      if (bulkOps.length > 0) {
        const result = await ProjectModel.bulkWrite(bulkOps);
        console.log(`Migration completed! Updated ${result.modifiedCount} projects`);
      }

      return {
        success: true,
        message: `Successfully added orderIndex to ${bulkOps.length} projects`,
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
      console.log("Rolling back project orderIndex migration...");

      const ProjectModel = model("Project");

      const result = await ProjectModel.updateMany(
        {},
        {
          $unset: { orderIndex: "" },
          $set: { updatedAt: new Date() },
        }
      );

      console.log(`Rollback completed! Removed orderIndex from ${result.modifiedCount} projects`);

      return {
        success: true,
        message: `Successfully removed orderIndex from ${result.modifiedCount} projects`,
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
