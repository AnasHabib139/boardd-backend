"use strict";

const { Schema, model, Types } = require("mongoose");

const taskConnectionSchema = new Schema(
  {
    sourceTaskId: {
      type: Types.ObjectId,
      ref: "Task",
      required: true,
    },
    targetTaskId: {
      type: Types.ObjectId,
      ref: "Task",
      required: true,
    },
    companyId: {
      type: Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    createdBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Compound unique index to prevent duplicate A→B connections
taskConnectionSchema.index(
  { sourceTaskId: 1, targetTaskId: 1 },
  { unique: true }
);

// Reverse index for efficient bidirectional lookups
taskConnectionSchema.index({ targetTaskId: 1, sourceTaskId: 1 });

const TaskConnectionModel = model("TaskConnection", taskConnectionSchema);

exports.TaskConnectionModel = TaskConnectionModel;

exports.createTaskConnection = (obj) => TaskConnectionModel.create(obj);

exports.findTaskConnection = (query) => TaskConnectionModel.findOne(query);

exports.findTaskConnections = (taskId) =>
  TaskConnectionModel.find({
    $or: [{ sourceTaskId: taskId }, { targetTaskId: taskId }],
  });

exports.deleteTaskConnection = (query) =>
  TaskConnectionModel.findOneAndDelete(query);

exports.deleteTaskConnectionsByTaskId = (taskId) =>
  TaskConnectionModel.deleteMany({
    $or: [{ sourceTaskId: taskId }, { targetTaskId: taskId }],
  });

exports.aggregateTaskConnections = (pipeline) =>
  TaskConnectionModel.aggregate(pipeline);
