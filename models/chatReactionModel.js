"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");

const chatReactionSchema = new Schema(
  {
    messageId: {
      type: Types.ObjectId,
      ref: "ChatMessage",
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

// Indexes for performance

// 1. Unique constraint - prevent duplicate reactions
chatReactionSchema.index(
  { messageId: 1, userId: 1, emoji: 1 },
  { unique: true }
);

// 2. Get all reactions for a message
chatReactionSchema.index({ messageId: 1, createdAt: 1 });

// 3. Get user's reactions
chatReactionSchema.index({ userId: 1, createdAt: -1 });

// Register plugins
chatReactionSchema.plugin(mongoosePaginate);
chatReactionSchema.plugin(aggregatePaginate);

const ChatReaction = model("ChatReaction", chatReactionSchema);

// ==================== CRUD Helper Functions ====================

// Create a new reaction
exports.createChatReaction = (reactionData) => ChatReaction.create(reactionData);

// Find a single reaction
exports.findChatReaction = (query) => ChatReaction.findOne(query);

// Find multiple reactions
exports.findManyChatReactions = (query) => ChatReaction.find(query);

// Delete a reaction
exports.deleteChatReaction = (query) => ChatReaction.findOneAndDelete(query);

// Count reactions
exports.countChatReactions = (query) => ChatReaction.countDocuments(query);

// ==================== Specialized Helper Functions ====================

/**
 * Add a reaction to a message
 * @param {Object} params - { messageId, userId, emoji }
 * @returns {Promise<Object>} Created reaction or existing one
 */
exports.addReaction = async ({ messageId, userId, emoji }) => {
  try {
    // Try to create, will fail if duplicate exists (which is fine)
    const reaction = await ChatReaction.create({
      messageId,
      userId,
      emoji,
    });
    return { reaction, isNew: true };
  } catch (error) {
    // If duplicate key error, user already reacted with this emoji
    if (error.code === 11000) {
      const existingReaction = await ChatReaction.findOne({
        messageId,
        userId,
        emoji,
      });
      return { reaction: existingReaction, isNew: false };
    }
    throw error;
  }
};

/**
 * Remove a reaction from a message
 * @param {Object} params - { messageId, userId, emoji }
 * @returns {Promise<Object|null>} Deleted reaction or null
 */
exports.removeReaction = async ({ messageId, userId, emoji }) => {
  return ChatReaction.findOneAndDelete({
    messageId,
    userId,
    emoji,
  });
};

/**
 * Toggle reaction (add if doesn't exist, remove if exists)
 * @param {Object} params - { messageId, userId, emoji }
 * @returns {Promise<Object>} { action: 'added'|'removed', reaction }
 */
exports.toggleReaction = async ({ messageId, userId, emoji }) => {
  const existingReaction = await ChatReaction.findOne({
    messageId,
    userId,
    emoji,
  });

  if (existingReaction) {
    // Remove reaction
    await ChatReaction.findByIdAndDelete(existingReaction._id);
    return {
      action: "removed",
      reaction: existingReaction,
    };
  } else {
    // Add reaction
    const newReaction = await ChatReaction.create({
      messageId,
      userId,
      emoji,
    });
    return {
      action: "added",
      reaction: newReaction,
    };
  }
};

/**
 * Get all reactions for a message, grouped by emoji
 * @param {String} messageId
 * @returns {Promise<Array>} Grouped reactions
 * Example: [{ emoji: '👍', count: 5, users: [...] }, { emoji: '❤️', count: 3, users: [...] }]
 */
exports.getReactionsByMessage = async (messageId) => {
  const reactions = await ChatReaction.aggregate([
    {
      $match: { messageId: new Types.ObjectId(messageId) },
    },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    {
      $unwind: "$user",
    },
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
        createdAt: { $first: "$createdAt" },
      },
    },
    {
      $project: {
        _id: 0,
        emoji: "$_id",
        count: 1,
        users: 1,
        createdAt: 1,
      },
    },
    {
      $sort: { createdAt: 1 }, // Order by first reaction time
    },
  ]);

  return reactions;
};

/**
 * Get reaction summary for a message (count per emoji)
 * @param {String} messageId
 * @returns {Promise<Object>} { '👍': 5, '❤️': 3, ... }
 */
exports.getReactionCounts = async (messageId) => {
  const reactions = await ChatReaction.aggregate([
    {
      $match: { messageId: new Types.ObjectId(messageId) },
    },
    {
      $group: {
        _id: "$emoji",
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = {};
  reactions.forEach((r) => {
    counts[r._id] = r.count;
  });

  return counts;
};

/**
 * Get user's reaction on a message (if any)
 * @param {String} messageId
 * @param {String} userId
 * @returns {Promise<Array>} Array of emoji strings
 */
exports.getUserReactions = async (messageId, userId) => {
  const reactions = await ChatReaction.find(
    {
      messageId,
      userId,
    },
    { emoji: 1 }
  ).lean();

  return reactions.map((r) => r.emoji);
};

/**
 * Check if user has reacted to a message with specific emoji
 * @param {String} messageId
 * @param {String} userId
 * @param {String} emoji
 * @returns {Promise<Boolean>}
 */
exports.hasUserReacted = async (messageId, userId, emoji) => {
  const reaction = await ChatReaction.findOne({
    messageId,
    userId,
    emoji,
  });
  return !!reaction;
};

/**
 * Remove all reactions for a message (when message is deleted)
 * @param {String} messageId
 * @returns {Promise<Object>} Delete result
 */
exports.removeAllReactionsForMessage = async (messageId) => {
  return ChatReaction.deleteMany({ messageId });
};

/**
 * Get reaction statistics for a conversation
 * @param {String} conversationId
 * @returns {Promise<Array>} Top emojis used
 */
exports.getConversationReactionStats = async (conversationId) => {
  const { findManyChatMessages } = require("./chatMessageModel");

  // Get all message IDs in conversation
  const messages = await findManyChatMessages(
    { conversationId },
    { _id: 1 }
  ).lean();
  const messageIds = messages.map((m) => m._id);

  const stats = await ChatReaction.aggregate([
    {
      $match: { messageId: { $in: messageIds } },
    },
    {
      $group: {
        _id: "$emoji",
        totalCount: { $sum: 1 },
        uniqueUsers: { $addToSet: "$userId" },
      },
    },
    {
      $project: {
        emoji: "$_id",
        totalCount: 1,
        uniqueUserCount: { $size: "$uniqueUsers" },
      },
    },
    {
      $sort: { totalCount: -1 },
    },
    {
      $limit: 10, // Top 10 emojis
    },
  ]);

  return stats;
};

/**
 * Get recent reactions by a user
 * @param {String} userId
 * @param {Number} limit
 * @returns {Promise<Array>} Recent reactions with message info
 */
exports.getUserRecentReactions = async (userId, limit = 20) => {
  return ChatReaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("messageId", "contentText conversationId")
    .lean();
};
