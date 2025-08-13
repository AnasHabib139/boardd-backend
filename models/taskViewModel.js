"use strict";

const { Schema, model, Types } = require("mongoose");

const taskViewSchema = new Schema({
  userId: { type: Types.ObjectId, ref: "User", required: true },
  taskId: { type: Types.ObjectId, ref: "Task", required: true },
  lastViewedAt: { type: Date, default: Date.now },
});

// Unique per user per task
taskViewSchema.index({ userId: 1, taskId: 1 }, { unique: true });
taskViewSchema.index({ lastViewedAt: -1 });

const TaskViewModel = model("TaskView", taskViewSchema);

// Upsert last viewed timestamp for a (user, task)
exports.upsertTaskView = async ({ userId, taskId, when = new Date() }) => {
  const castUserId =
    typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  const castTaskId =
    typeof taskId === "string" ? new Types.ObjectId(taskId) : taskId;

  // Use updateOne with upsert for a guaranteed insert on first view
  const result = await TaskViewModel.updateOne(
    { userId: castUserId, taskId: castTaskId },
    {
      $set: { lastViewedAt: when },
      $setOnInsert: { userId: castUserId, taskId: castTaskId },
    },
    { upsert: true }
  );

  return result;
};

exports.findTaskView = (query) => TaskViewModel.findOne(query);
exports.findManyTaskViews = (query) => TaskViewModel.find(query);
exports.TaskViewModel = TaskViewModel;