"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const taskCommentReactionSchema = new Schema(
  {
    commentId: {
      type: Types.ObjectId,
      ref: "TaskComment",
      required: true,
      index: true,
    },
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Emoji can be Unicode (👍) or shortcode (:thumbsup:)
    emoji: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false, // Reactions don't need updatedAt
    },
  }
);

// Unique constraint - prevent duplicate reactions
taskCommentReactionSchema.index(
  { commentId: 1, userId: 1, emoji: 1 },
  { unique: true }
);

// Get all reactions for a comment
taskCommentReactionSchema.index({ commentId: 1, createdAt: 1 });

taskCommentReactionSchema.plugin(mongoosePaginate);
taskCommentReactionSchema.plugin(aggregatePaginate);

const TaskCommentReaction = model(
  "TaskCommentReaction",
  taskCommentReactionSchema
);

// ==================== CRUD Helper Functions ====================

exports.findTaskCommentReaction = (query) => TaskCommentReaction.findOne(query);

exports.findManyTaskCommentReactions = (query) =>
  TaskCommentReaction.find(query);

/**
 * Toggle reaction (add if doesn't exist, remove if exists)
 * @param {Object} params - { commentId, userId, emoji }
 * @returns {Promise<Object>} { action: 'added'|'removed', reaction }
 */
exports.toggleReaction = async ({ commentId, userId, emoji }) => {
  const existingReaction = await TaskCommentReaction.findOne({
    commentId,
    userId,
    emoji,
  });

  if (existingReaction) {
    await TaskCommentReaction.findByIdAndDelete(existingReaction._id);
    return { action: "removed", reaction: existingReaction };
  }

  try {
    const newReaction = await TaskCommentReaction.create({
      commentId,
      userId,
      emoji,
    });
    return { action: "added", reaction: newReaction };
  } catch (error) {
    // Duplicate key race: another request created it between findOne and create
    if (error.code === 11000) {
      const reaction = await TaskCommentReaction.findOne({
        commentId,
        userId,
        emoji,
      });
      return { action: "added", reaction };
    }
    throw error;
  }
};

/**
 * Get all reactions for a comment, grouped by emoji
 * @returns {Promise<Array>} [{ emoji, count, users: [{_id,name,email,image}] }]
 */
exports.getReactionsByComment = async (commentId) => {
  return TaskCommentReaction.aggregate([
    { $match: { commentId: new Types.ObjectId(commentId) } },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $group: {
        _id: "$emoji",
        count: { $sum: 1 },
        users: {
          $push: {
            _id: "$user._id",
            name: "$user.name",
            email: "$user.email",
            image: "$user.image",
          },
        },
        firstReactedAt: { $min: "$createdAt" },
      },
    },
    {
      $project: {
        _id: 0,
        emoji: "$_id",
        count: 1,
        users: 1,
        firstReactedAt: 1,
      },
    },
    { $sort: { firstReactedAt: 1 } },
  ]);
};

/**
 * Get grouped reactions for many comments in one query.
 * @param {Array} commentIds - array of ObjectId or hex strings
 * @returns {Promise<Object>} { [commentIdString]: [{ emoji, count, users }] }
 */
exports.getReactionsGroupedByComments = async (commentIds) => {
  if (!commentIds || commentIds.length === 0) return {};

  const objectIds = commentIds.map((id) =>
    typeof id === "string" ? Types.ObjectId.createFromHexString(id) : id
  );

  const rows = await TaskCommentReaction.aggregate([
    { $match: { commentId: { $in: objectIds } } },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $group: {
        _id: { commentId: "$commentId", emoji: "$emoji" },
        count: { $sum: 1 },
        users: {
          $push: {
            _id: "$user._id",
            name: "$user.name",
            email: "$user.email",
            image: "$user.image",
          },
        },
        firstReactedAt: { $min: "$createdAt" },
      },
    },
    { $sort: { firstReactedAt: 1 } },
    {
      $group: {
        _id: "$_id.commentId",
        reactions: {
          $push: { emoji: "$_id.emoji", count: "$count", users: "$users" },
        },
      },
    },
  ]);

  const map = {};
  rows.forEach((row) => {
    map[row._id.toString()] = row.reactions;
  });
  return map;
};

/**
 * Remove all reactions for a set of comments (on comment/task delete)
 * @param {Array} commentIds
 */
exports.removeAllReactionsForComments = (commentIds) =>
  TaskCommentReaction.deleteMany({ commentId: { $in: commentIds } });

exports.TaskCommentReactionModel = TaskCommentReaction;
