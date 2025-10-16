"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const taskCommentSchema = new Schema({
  taskId: { type: Types.ObjectId, ref: "Task", required: true },
  userId: { type: Types.ObjectId, ref: "User", required: true },
  message: { type: String, default: "" }, // Can contain emojis
  attachments: [{ type: String }], // Array of file paths/URLs
  links: [{ type: String }], // Array of URLs
  isActive: { type: Boolean, default: true }, // For soft delete
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Add validation: at least one of message, attachments, or links must exist
taskCommentSchema.pre("validate", function (next) {
  const hasMessage = this.message && this.message.trim().length > 0;
  const hasAttachments = this.attachments && this.attachments.length > 0;
  const hasLinks = this.links && this.links.length > 0;

  if (!hasMessage && !hasAttachments && !hasLinks) {
    next(new Error("At least one of message, attachments, or links is required"));
  } else {
    next();
  }
});

// Register pagination plugins
taskCommentSchema.plugin(mongoosePaginate);
taskCommentSchema.plugin(aggregatePaginate);

const TaskCommentModel = model("TaskComment", taskCommentSchema);

// Create new task comment
exports.createTaskComment = (obj) => TaskCommentModel.create(obj);

// Find task comment by query
exports.findTaskComment = (query) => TaskCommentModel.findOne(query);

// Find many task comments by query
exports.findManyTaskComments = (query) => TaskCommentModel.find(query);

// Update task comment by query
exports.updateTaskComment = (query, update, options = {}) =>
  TaskCommentModel.findOneAndUpdate(query, update, { new: true, ...options });

// Delete task comment by query
exports.deleteTaskComment = (query) => TaskCommentModel.findOneAndDelete(query);

// Get all task comments with pagination
exports.getAllTaskComments = async ({ query, page, limit, responseKey = "comments" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TaskCommentModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};

exports.TaskCommentModel = TaskCommentModel;
