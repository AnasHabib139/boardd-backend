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
    enum: ["low", "medium", "high"],
    default: "medium",
  },
  color: { type: String, required: true },
  isPinned: { type: Boolean, default: false }, // Project pinning flag
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
