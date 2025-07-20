"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");
const { ACTION_TYPE } = require("../utils/constants");

const activitySchema = new Schema({
  // Context references
  projectId: { type: Types.ObjectId, ref: "Project" }, // Made optional for client activities
  taskId: { type: Types.ObjectId, ref: "Task" },
  subtaskId: { type: Types.ObjectId, ref: "Subtask" },

  // Client context references
  tabId: { type: Types.ObjectId, ref: "ChannelTab" }, // For client activities
  clientId: { type: Types.ObjectId, ref: "Client" }, // For client activities

  // Activity metadata
  userId: { type: Types.ObjectId, ref: "User", required: true },
  actionType: {
    type: String,
    enum: Object.values(ACTION_TYPE),
    required: true,
  },

  // Changed field details
  field: { type: String },
  previousValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },

  // Activity message
  message: {
    forCreator: { type: String },
    forOthers: { type: String },
  },

  // Timestamp
  timestamp: { type: Date, default: Date.now },
});

// Add validation to ensure either projectId or tabId is provided
activitySchema.pre("validate", function (next) {
  if (!this.projectId && !this.tabId) {
    next(new Error("Either projectId or tabId must be provided"));
  } else {
    next();
  }
});

// register pagination plugin to activity model
activitySchema.plugin(mongoosePaginate);
activitySchema.plugin(aggregatePaginate);

const ActivityModel = model("Activity", activitySchema);

// create new activity
exports.createActivity = (obj) => ActivityModel.create(obj);

// find activity by query
exports.findActivity = (query) => ActivityModel.findOne(query);

// get all activities
exports.getAllActivities = async ({
  query,
  page,
  limit,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: ActivityModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};

// get activities for a project
exports.getProjectActivities = async ({ projectId, page, limit }) => {
  const query = [
    {
      $match: {
        projectId: Types.ObjectId.isValid(projectId)
          ? new Types.ObjectId(projectId)
          : null,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        actionType: 1,
        field: 1,
        previousValue: 1,
        newValue: 1,
        timestamp: 1,
        taskId: 1,
        subtaskId: 1,
        user: { _id: 1, name: 1, email: 1 },
      },
    },
    { $sort: { timestamp: -1 } },
  ];

  return exports.getAllActivities({
    query,
    page: page || 1,
    limit: limit || 20,
    responseKey: "activities",
  });
};

// get activities for a task
exports.getTaskActivities = async ({ taskId, page, limit }) => {
  const query = [
    {
      $match: {
        taskId: Types.ObjectId.isValid(taskId)
          ? new Types.ObjectId(taskId)
          : null,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        actionType: 1,
        field: 1,
        previousValue: 1,
        newValue: 1,
        timestamp: 1,
        message: 1,
        user: { _id: 1, name: 1, email: 1 },
      },
    },
    { $sort: { timestamp: -1 } },
  ];

  return exports.getAllActivities({
    query,
    page: page || 1,
    limit: limit || 20,
    responseKey: "activities",
  });
};
