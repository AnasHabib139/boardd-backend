"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const subtaskSchema = new Schema({
  title: { type: String, required: true },
  taskId: { type: Types.ObjectId, ref: "Task", required: true },
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  createdBy: { type: Types.ObjectId, ref: "User", required: true },
  assignedTo: [{ type: Types.ObjectId, ref: "User" }],
  isActive: { type: Boolean, default: true },
  isCompleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// register pagination plugin to subtask model
subtaskSchema.plugin(mongoosePaginate);
subtaskSchema.plugin(aggregatePaginate);

const SubtaskModel = model("Subtask", subtaskSchema);

// create new subtask
exports.createSubtask = (obj) => SubtaskModel.create(obj);

// find subtask by query
exports.findSubtask = (query) => SubtaskModel.findOne(query);

// update subtask by query
exports.updateSubtask = (query, update, options = {}) =>
  SubtaskModel.findOneAndUpdate(query, update, { new: true, ...options });

// delete subtask by query
exports.deleteSubtask = (query) => SubtaskModel.findOneAndDelete(query);

// get all subtasks
exports.getAllSubtasks = async ({
  query,
  page,
  limit,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: SubtaskModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};
