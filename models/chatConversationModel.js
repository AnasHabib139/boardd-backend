"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

// Participant subdocument schema for read tracking
const participantSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastReadAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const chatConversationSchema = new Schema(
  {
    companyId: {
      type: Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["channel", "dm", "group_dm"],
      required: true,
    },
    // For channel type conversations
    channelId: {
      type: Types.ObjectId,
      ref: "Channel",
      sparse: true, // Only for channel type
    },
    // For dm and group_dm types
    participantIds: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
    // Per-user read tracking
    participants: [participantSchema],
    // Last message info for sidebar previews
    lastMessageAt: {
      type: Date,
      default: null,
    },
    lastMessageText: {
      type: String,
      default: "",
      maxlength: 500, // Truncate long messages
    },
    createdBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
// 1. For channel conversations lookup
chatConversationSchema.index(
  { companyId: 1, type: 1, channelId: 1 },
  { sparse: true, unique: true }
);

// 2. For DM/group DM lookup (participantIds should be sorted before query)
chatConversationSchema.index({ companyId: 1, type: 1, participantIds: 1 });

// 3. For recent conversations list
chatConversationSchema.index({ companyId: 1, updatedAt: -1 });

// 4. For user's conversations
chatConversationSchema.index({ "participants.userId": 1 });

// Register plugins
chatConversationSchema.plugin(mongoosePaginate);
chatConversationSchema.plugin(aggregatePaginate);

const ChatConversation = model("ChatConversation", chatConversationSchema);

// ==================== CRUD Helper Functions ====================

// Create a new conversation
exports.createChatConversation = (conversationData) =>
  ChatConversation.create(conversationData);

// Find a single conversation
exports.findChatConversation = (query) => ChatConversation.findOne(query);

// Find multiple conversations
exports.findManyChatConversations = (query) => ChatConversation.find(query);

// Update a conversation
exports.updateChatConversation = (query, update, options = {}) =>
  ChatConversation.findOneAndUpdate(query, update, { new: true, ...options });

// Delete a conversation (hard delete - use with caution)
exports.deleteChatConversation = (query) =>
  ChatConversation.findOneAndDelete(query);

// Get paginated conversations
exports.getAllChatConversations = async ({
  query,
  page = 1,
  limit = 20,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: ChatConversation,
    query,
    page,
    limit,
  });

  return { [responseKey]: data, pagination };
};

// Aggregate conversations (for complex queries)
exports.aggregateChatConversations = (pipeline) =>
  ChatConversation.aggregate(pipeline);

// ==================== Specialized Helper Functions ====================

/**
 * Find or create a conversation based on type and participants
 * @param {Object} params - { companyId, type, channelId?, participantIds?, createdBy }
 * @param {Boolean} createIfMissing - Create if not found
 * @returns {Promise<Object>} Conversation document
 */
exports.resolveConversation = async (params, createIfMissing = false) => {
  const { companyId, type, channelId, participantIds, createdBy } = params;

  let query = { companyId, type };

  if (type === "channel") {
    if (!channelId) {
      throw new Error("channelId is required for channel conversations");
    }
    query.channelId = channelId;
  } else {
    // For dm and group_dm
    if (!participantIds || participantIds.length === 0) {
      throw new Error("participantIds are required for DM conversations");
    }

    // Sort participantIds for stable lookup
    const sortedParticipantIds = [...participantIds]
      .map((id) => id.toString())
      .sort();

    query.participantIds = {
      $all: sortedParticipantIds,
      $size: sortedParticipantIds.length,
    };
  }

  // Try to find existing conversation
  let conversation = await ChatConversation.findOne(query);

  // Create if not found and requested
  if (!conversation && createIfMissing) {
    const conversationData = {
      companyId,
      type,
      createdBy,
    };

    if (type === "channel") {
      conversationData.channelId = channelId;
    } else {
      // Sort and store participantIds
      conversationData.participantIds = [...participantIds]
        .map((id) => id.toString())
        .sort()
        .map((id) => new Types.ObjectId(id));
    }

    // Initialize participants array with read tracking
    conversationData.participants = conversationData.participantIds
      ? conversationData.participantIds.map((userId) => ({
          userId,
          lastReadAt: null,
        }))
      : [];

    conversation = await ChatConversation.create(conversationData);
  }

  return conversation;
};

/**
 * Update last message info for conversation
 * @param {String} conversationId
 * @param {String} messageText - Preview text
 * @param {Date} messageTimestamp
 */
exports.updateLastMessage = async (
  conversationId,
  messageText,
  messageTimestamp
) => {
  return ChatConversation.findByIdAndUpdate(
    conversationId,
    {
      lastMessageAt: messageTimestamp,
      lastMessageText: messageText.substring(0, 500), // Truncate
      updatedAt: messageTimestamp,
    },
    { new: true }
  );
};

/**
 * Update user's lastReadAt in conversation
 * @param {String} conversationId
 * @param {String} userId
 * @param {Date} readAt - Timestamp (defaults to now)
 */
exports.markAsRead = async (conversationId, userId, readAt = new Date()) => {
  return ChatConversation.findOneAndUpdate(
    {
      _id: conversationId,
      "participants.userId": userId,
    },
    {
      $set: {
        "participants.$.lastReadAt": readAt,
      },
    },
    { new: true }
  );
};

/**
 * Get unread count for user in a conversation
 * @param {String} conversationId
 * @param {String} userId
 * @returns {Promise<Number>} Unread count
 */
exports.getUnreadCount = async (conversationId, userId) => {
  const { findManyChatMessages } = require("./chatMessageModel");

  const conversation = await ChatConversation.findById(conversationId);
  if (!conversation) return 0;

  const participant = conversation.participants.find(
    (p) => p.userId.toString() === userId.toString()
  );

  if (!participant || !participant.lastReadAt) {
    // User hasn't read anything, count all messages except their own
    const { countChatMessages } = require("./chatMessageModel");
    return await countChatMessages({
      conversationId,
      authorId: { $ne: userId },
    });
  }

  // Count messages after lastReadAt
  const { countChatMessages } = require("./chatMessageModel");
  return await countChatMessages({
    conversationId,
    createdAt: { $gt: participant.lastReadAt },
    authorId: { $ne: userId },
  });
};

/**
 * Add a participant to group DM
 * @param {String} conversationId
 * @param {String} userId
 */
exports.addParticipant = async (conversationId, userId) => {
  return ChatConversation.findByIdAndUpdate(
    conversationId,
    {
      $addToSet: {
        participantIds: userId,
        participants: { userId, lastReadAt: null },
      },
    },
    { new: true }
  );
};

/**
 * Remove a participant from group DM
 * @param {String} conversationId
 * @param {String} userId
 */
exports.removeParticipant = async (conversationId, userId) => {
  return ChatConversation.findByIdAndUpdate(
    conversationId,
    {
      $pull: {
        participantIds: userId,
        participants: { userId },
      },
    },
    { new: true }
  );
};
