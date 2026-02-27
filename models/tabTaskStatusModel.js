"use strict";

const { Schema, model, Types } = require("mongoose");

/**
 * Project Task Status Model
 * Defines custom task statuses for a project (each project has its own statuses)
 *
 * - statusKey: Immutable identifier used in task.status field and for calculations
 * - statusName: Display name that users can rename
 * - System statuses (todo, in_progress, completed) can be renamed but not deleted
 */
const tabTaskStatusSchema = new Schema({
  projectId: {
    type: Types.ObjectId,
    ref: "Project",
    required: true,
    index: true,
  },
  statusKey: {
    type: String,
    required: true,
    trim: true,
  },
  statusName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  color: {
    type: String,
    default: "#6B7280",
    match: /^#[0-9A-Fa-f]{6}$/,
  },
  order: {
    type: Number,
    default: 0,
  },
  isSystem: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Unique constraint: one statusKey per project
tabTaskStatusSchema.index({ projectId: 1, statusKey: 1 }, { unique: true });

// Index for ordering queries
tabTaskStatusSchema.index({ projectId: 1, order: 1 });

const TabTaskStatus = model("TabTaskStatus", tabTaskStatusSchema);

// Default system statuses
const SYSTEM_STATUSES = [
  { statusKey: "todo", statusName: "To Do", color: "#6B7280", order: 1, isSystem: true },
  { statusKey: "in_progress", statusName: "In Progress", color: "#3B82F6", order: 2, isSystem: true },
  { statusKey: "completed", statusName: "Completed", color: "#22C55E", order: 3, isSystem: true },
];

// Create a new status
exports.createTabTaskStatus = (obj) => TabTaskStatus.create(obj);

// Create multiple statuses (for initialization)
exports.createManyTabTaskStatuses = (arr) => TabTaskStatus.insertMany(arr);

// Find single status
exports.findTabTaskStatus = (query) => TabTaskStatus.findOne(query);

// Find multiple statuses
exports.findManyTabTaskStatuses = (query) => TabTaskStatus.find(query).sort({ order: 1 });

// Update status
exports.updateTabTaskStatus = (query, update) =>
  TabTaskStatus.findOneAndUpdate(query, { ...update, updatedAt: new Date() }, { new: true });

// Delete status (hard delete)
exports.deleteTabTaskStatus = (query) => TabTaskStatus.findOneAndDelete(query);

// Get next order index for a project
exports.getNextStatusOrder = async (projectId) => {
  const lastStatus = await TabTaskStatus.findOne({ projectId, isActive: true })
    .sort({ order: -1 })
    .select("order");
  return lastStatus ? lastStatus.order + 1 : 1;
};

// Initialize system statuses for a new project
exports.initializeSystemStatuses = async (projectId) => {
  const statuses = SYSTEM_STATUSES.map((status) => ({
    ...status,
    projectId,
  }));
  return TabTaskStatus.insertMany(statuses);
};

// Check if project has statuses initialized
exports.hasStatusesInitialized = async (projectId) => {
  const count = await TabTaskStatus.countDocuments({ projectId });
  return count > 0;
};

// Get all status keys for a project (for validation)
exports.getProjectStatusKeys = async (projectId) => {
  // Use same pattern as findManyTabTaskStatuses that works in controller
  const statuses = await TabTaskStatus.find({ projectId, isActive: true })
    .sort({ order: 1 })
    .select("statusKey");
  console.log("getProjectStatusKeys for", projectId, "found:", statuses.map(s => s.statusKey));
  return statuses.map((s) => s.statusKey);
};

// Resolve a statusKey to its display name
exports.getStatusName = async (projectId, statusKey) => {
  if (!projectId) {
    const systemStatus = SYSTEM_STATUSES.find((s) => s.statusKey === statusKey);
    return systemStatus ? systemStatus.statusName : statusKey;
  }
  const status = await TabTaskStatus.findOne({ projectId, statusKey });
  return status ? status.statusName : statusKey;
};

// Export model and constants
exports.TabTaskStatus = TabTaskStatus;
exports.SYSTEM_STATUSES = SYSTEM_STATUSES;
