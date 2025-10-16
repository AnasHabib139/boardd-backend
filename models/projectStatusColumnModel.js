"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");
const { PROJECT_COLUMN_TYPES } = require("../utils/constants");

const projectStatusColumnSchema = new Schema({
  tabId: { type: Types.ObjectId, ref: "ChannelTab", required: true },
  columnKey: { type: String, required: true },
  columnName: { type: String, required: true },
  columnType: {
    type: String,
    enum: Object.values(PROJECT_COLUMN_TYPES),
    required: true
  },
  dropdownOptions: [String],
  order: { type: Number, default: 0 },
  defaultValue: { type: Schema.Types.Mixed },
  isRequired: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Compound index for efficient queries per tab
projectStatusColumnSchema.index({ tabId: 1, columnKey: 1 }, { unique: true });

// register pagination plugin
projectStatusColumnSchema.plugin(mongoosePaginate);
projectStatusColumnSchema.plugin(aggregatePaginate);

const ProjectStatusColumnModel = model("ProjectStatusColumn", projectStatusColumnSchema);

// create new project status column
exports.createProjectStatusColumn = (obj) => ProjectStatusColumnModel.create(obj);

// find project status column by query
exports.findProjectStatusColumn = (query) => ProjectStatusColumnModel.findOne(query);

// find many project status columns by query
exports.findManyProjectStatusColumns = (query) => ProjectStatusColumnModel.find(query);

// update project status column by query
exports.updateProjectStatusColumn = (query, update, options = {}) =>
  ProjectStatusColumnModel.findOneAndUpdate(query, update, { new: true, ...options });

// delete project status column by query
exports.deleteProjectStatusColumn = (query) => ProjectStatusColumnModel.findOneAndDelete(query);

// get all project status columns
exports.getAllProjectStatusColumns = async ({ query, page, limit, responseKey = "data" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: ProjectStatusColumnModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};

// get columns for specific project and status
exports.getProjectStatusColumns = (projectId, status) =>
  ProjectStatusColumnModel.find({ projectId, status, isActive: true }).sort({ order: 1 });

// get all columns for project (all statuses)
exports.getAllProjectColumns = (projectId) =>
  ProjectStatusColumnModel.find({ projectId, isActive: true }).sort({ status: 1, order: 1 });

// get next order index for a tab
exports.getNextOrderIndex = async (tabId) => {
  const lastColumn = await ProjectStatusColumnModel.findOne({ tabId })
    .sort({ order: -1 });

  return lastColumn ? lastColumn.order + 1 : 1;
};