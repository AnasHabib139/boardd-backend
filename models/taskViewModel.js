"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const taskViewSchema = new Schema({
  userId: { type: Types.ObjectId, ref: "User", required: true },
  taskId: { type: Types.ObjectId, ref: "Task", required: true },
  lastViewedAt: { type: Date, default: Date.now },
  clickCount: { type: Number, default: 1 }, // Track total clicks on this task by this user
  firstViewedAt: { type: Date, default: Date.now }, // When user first viewed this task
});

// Unique per user per task
taskViewSchema.index({ userId: 1, taskId: 1 }, { unique: true });
taskViewSchema.index({ lastViewedAt: -1 });
taskViewSchema.index({ clickCount: -1 }); // Index for trending queries
taskViewSchema.index({ userId: 1, clickCount: -1 }); // User-specific trending

// Add plugins
taskViewSchema.plugin(mongoosePaginate);
taskViewSchema.plugin(aggregatePaginate);

const TaskViewModel = model("TaskView", taskViewSchema);

// Upsert last viewed timestamp and increment click count for a (user, task)
exports.upsertTaskView = async ({ userId, taskId, when = new Date() }) => {
  const castUserId =
    typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  const castTaskId =
    typeof taskId === "string" ? new Types.ObjectId(taskId) : taskId;

  // Use updateOne with upsert - increment click count on each view
  const result = await TaskViewModel.updateOne(
    { userId: castUserId, taskId: castTaskId },
    {
      $set: { lastViewedAt: when },
      $inc: { clickCount: 1 }, // Increment click count each time
      $setOnInsert: {
        userId: castUserId,
        taskId: castTaskId,
        firstViewedAt: when,
      },
    },
    { upsert: true }
  );

  return result;
};

// Get trending tasks with pagination (most clicked incomplete tasks)
exports.getTrendingTasks = async ({
  query,
  page,
  limit,
  responseKey = "trendingTasks",
  sort = { clickCount: -1, lastViewedAt: -1 },
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TaskViewModel,
    query,
    page,
    limit,
    sort,
  });
  return { [responseKey]: data, pagination };
};

exports.findTaskView = (query) => TaskViewModel.findOne(query);
exports.findManyTaskViews = (query) => TaskViewModel.find(query);
exports.TaskViewModel = TaskViewModel;
