"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const projectSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String },
  createdBy: { type: Types.ObjectId, ref: "User", required: true },
  companyId: { type: Types.ObjectId, ref: "Company", required: true },
  channelId: { type: Types.ObjectId, ref: "Channel", required: true },
  tabId: { type: Types.ObjectId, ref: "ChannelTab", required: true },
  status: { type: String, enum: ["active", "archived"], default: "active" },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  priority: {
    type: String,
    enum: ["none", "low", "medium", "high", "urgent", "critical"],
    default: "medium",
  },
  color: { type: String, required: true },
  isPinned: { type: Boolean, default: false }, // Project pinning flag
  orderIndex: { type: Number, default: 1000 }, // For drag-and-drop reordering
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// register pagination plugin to project model
projectSchema.plugin(mongoosePaginate);
projectSchema.plugin(aggregatePaginate);

const ProjectModel = model("Project", projectSchema);

// create new project
exports.createProject = (obj) => ProjectModel.create(obj);

// find project by query
exports.findProject = (query) => ProjectModel.findOne(query);

// get all projects
exports.getAllProjects = async ({
  query,
  page,
  limit,
  responseKey = "data",
  sort = { createdAt: -1 },
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: ProjectModel,
    query,
    page,
    limit,
    sort,
  });
  return { [responseKey]: data, pagination };
};

// get all projects without pagination (for calendar view)
exports.getAllProjectsWithoutPagination = async (query) => {
  try {
    const data = await ProjectModel.aggregate(query);
    return data;
  } catch (error) {
    console.error("Error in getAllProjectsWithoutPagination:", error);
    throw error;
  }
};

// update project
exports.updateProject = (query, update, options = {}) =>
  ProjectModel.findOneAndUpdate(query, update, { new: true, ...options });

// find many projects
exports.findManyProjects = (query, options = {}) =>
  ProjectModel.find(query, null, options);

// delete project
exports.deleteProject = (query) => ProjectModel.findOneAndDelete(query);

// Utility functions for drag and drop ordering

// Get next order index for a tab (for new projects)
exports.getNextProjectOrderIndex = async (tabId) => {
  const lastProject = await ProjectModel.findOne({
    tabId,
    status: "active",
  }).sort({ orderIndex: -1 });

  if (!lastProject || !lastProject.orderIndex) {
    return 1000; // Default starting order
  }

  return lastProject.orderIndex + 1000; // Add gap for future insertions
};

// Calculate order index for inserting between two projects
exports.calculateProjectOrderIndex = (previousOrderIndex, nextOrderIndex) => {
  if (!previousOrderIndex && !nextOrderIndex) {
    return 1000; // Default order
  }

  if (!previousOrderIndex) {
    return Math.max(nextOrderIndex / 2, 1); // Insert before first
  }

  if (!nextOrderIndex) {
    return previousOrderIndex + 1000; // Insert after last
  }

  return (previousOrderIndex + nextOrderIndex) / 2; // Insert between
};

// Update project order index
exports.updateProjectOrderIndex = async (projectId, newOrderIndex) => {
  return ProjectModel.findByIdAndUpdate(
    projectId,
    {
      $set: { orderIndex: newOrderIndex, updatedAt: new Date() },
    },
    { new: true }
  );
};
