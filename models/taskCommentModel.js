"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const taskCommentSchema = new Schema({
  taskId: { type: Types.ObjectId, ref: "Task", required: true },
  userId: { type: Types.ObjectId, ref: "User", required: true },
  contentDoc: { type: Schema.Types.Mixed, required: true }, // TipTap JSON document
  contentText: { type: String, default: "" }, // Derived plaintext for display/search
  attachments: [{ type: String }], // Array of file paths/URLs
  links: [{ type: String }], // Array of URLs
  // Threading: null = root comment, ObjectId = reply belonging to that root (single level)
  parentCommentId: { type: Types.ObjectId, ref: "TaskComment", default: null, index: true },
  // Thread aggregates (maintained on root comments only, recomputed on reply create/delete)
  replyCount: { type: Number, default: 0 },
  threadParticipants: [{ type: Types.ObjectId, ref: "User" }],
  isActive: { type: Boolean, default: true }, // For soft delete
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Validate: contentDoc or attachments must be present
taskCommentSchema.pre("validate", function (next) {
  const hasContent = this.contentDoc != null;
  const hasAttachments = this.attachments && this.attachments.length > 0;

  if (!hasContent && !hasAttachments) {
    next(new Error("At least contentDoc or attachments is required"));
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
exports.getAllTaskComments = async ({ query, page, limit, sort, responseKey = "comments" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TaskCommentModel,
    query,
    page,
    limit,
    ...(sort && { sort }),
  });
  return { [responseKey]: data, pagination };
};

// Delete many task comments (cascades: root delete, task delete)
exports.deleteManyTaskComments = (query) => TaskCommentModel.deleteMany(query);

/**
 * Recompute replyCount and threadParticipants on a root comment from its
 * remaining active replies. Self-healing — call after reply create AND delete.
 * @returns {Promise<Object>} the updated root comment
 */
exports.recomputeThreadAggregates = async (rootCommentId) => {
  const [replyCount, participantIds] = await Promise.all([
    TaskCommentModel.countDocuments({ parentCommentId: rootCommentId, isActive: true }),
    TaskCommentModel.distinct("userId", { parentCommentId: rootCommentId, isActive: true }),
  ]);
  return TaskCommentModel.findOneAndUpdate(
    { _id: rootCommentId },
    { replyCount, threadParticipants: participantIds },
    { new: true }
  );
};

exports.TaskCommentModel = TaskCommentModel;
