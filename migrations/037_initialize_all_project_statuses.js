"use strict";

const { model } = require("mongoose");

/**
 * Migration: Initialize statuses for all existing projects
 *
 * This migration:
 * 1. Gets all active projects
 * 2. For each project without statuses, creates system statuses (todo, in_progress, completed)
 */

const SYSTEM_STATUSES = [
  { statusKey: "todo", statusName: "To Do", color: "#6B7280", order: 1, isSystem: true },
  { statusKey: "in_progress", statusName: "In Progress", color: "#3B82F6", order: 2, isSystem: true },
  { statusKey: "completed", statusName: "Completed", color: "#22C55E", order: 3, isSystem: true },
];

module.exports = {
  name: "initialize_all_project_statuses",
  version: "1.0.0",
  description: "Initialize statuses for all existing projects",

  async up() {
    try {
      console.log("Starting migration: initialize_all_project_statuses");

      const Project = model("Project");
      const TabTaskStatus = model("TabTaskStatus");

      // Get all active projects
      const projects = await Project.find({ status: "active" }).select("_id").lean();
      console.log(`Found ${projects.length} active projects`);

      let initialized = 0;
      let skipped = 0;
      let errors = 0;

      for (const project of projects) {
        try {
          // Check if project already has statuses
          const existingCount = await TabTaskStatus.countDocuments({ projectId: project._id });

          if (existingCount > 0) {
            skipped++;
            continue;
          }

          // Initialize system statuses for this project
          const statuses = SYSTEM_STATUSES.map((status) => ({
            ...status,
            projectId: project._id,
            isActive: true,
          }));

          await TabTaskStatus.insertMany(statuses, { ordered: false });
          initialized++;
        } catch (err) {
          // If duplicate key error, it means statuses already exist - skip
          if (err.code === 11000) {
            skipped++;
          } else {
            console.error(`Error initializing statuses for project ${project._id}:`, err.message);
            errors++;
          }
        }
      }

      console.log(`Initialized statuses for ${initialized} projects, skipped ${skipped} (already had statuses)`);
      console.log("Migration completed: initialize_all_project_statuses");

      return {
        success: true,
        message: `Initialized ${initialized} projects, skipped ${skipped}`,
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
    // No rollback - statuses are expected to exist
    return {
      success: true,
      message: "No rollback action needed",
    };
  },
};
