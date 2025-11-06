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
      enum: ["channel", "dm", "group_dm", "client"],
      required: true,
    },
    // For channel and client type conversations
    channelId: {
      type: Types.ObjectId,
      ref: "Channel",
      sparse: true, // Only for channel and client types
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
    // Client chat specific fields (type='client')
    clientContact: {
      name: { type: String },
      email: { type: String },
      phoneE164: { type: String },
      whatsappE164: { type: String },
    },
    externalContacts: {
      emails: [{ type: String }],
      phoneE164s: [{ type: String }],
      whatsappE164s: [{ type: String }],
    },
    lastClientInboundAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
// 1. For channel and client conversations lookup (unique per channel)
// Using partial index to only apply uniqueness constraint to channel/client types
// This allows dm/group_dm conversations to have channelId: null without conflicts
chatConversationSchema.index(
  { companyId: 1, type: 1, channelId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: { $in: ["channel", "client"] },
      channelId: { $exists: true }
    }
  }
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
 * @param {Object} params - { companyId, type, channelId?, participantIds?, createdBy, clientContact? }
 * @param {Boolean} createIfMissing - Create if not found
 * @returns {Promise<Object>} Conversation document
 */
exports.resolveConversation = async (params, createIfMissing = false) => {
  const { companyId, type, channelId, participantIds, createdBy, clientContact } = params;

  let query = { companyId, type };

  if (type === "channel") {
    if (!channelId) {
      throw new Error("channelId is required for channel conversations");
    }
    query.channelId = channelId;
  } else if (type === "client") {
    // Client conversations are unique per channel (one client chat per channel)
    if (!channelId) {
      throw new Error("channelId is required for client conversations");
    }
    query.channelId = channelId;
  } else {
    // For dm and group_dm
    if (!participantIds || participantIds.length === 0) {
      throw new Error("participantIds are required for DM conversations");
    }

    // Ensure createdBy is included in participantIds (for query matching)
    const createdByStr = createdBy.toString();
    const participantIdStrs = participantIds.map((id) => id.toString());
    const allParticipantIds = participantIdStrs.includes(createdByStr)
      ? participantIdStrs
      : [...participantIdStrs, createdByStr];

    // Sort participantIds for stable lookup
    const sortedParticipantIds = [...allParticipantIds].sort();

    query.participantIds = {
      $all: sortedParticipantIds,
      $size: sortedParticipantIds.length,
    };
  }

  // Try to find existing conversation
  let conversation = await ChatConversation.findOne(query);
  let created = false;

  // Create if not found and requested
  if (!conversation && createIfMissing) {
    const conversationData = {
      companyId,
      type,
      createdBy,
    };

    if (type === "channel") {
      conversationData.channelId = channelId;
    } else if (type === "client") {
      // Client conversations include channelId and participantIds (team + client guest users)
      conversationData.channelId = channelId;

      if (participantIds && participantIds.length > 0) {
        // Ensure createdBy is included in participantIds
        const createdByStr = createdBy.toString();
        const participantIdStrs = participantIds.map((id) => id.toString());
        const allParticipantIds = participantIdStrs.includes(createdByStr)
          ? participantIdStrs
          : [...participantIdStrs, createdByStr];

        // Sort and store participantIds (team members + client guest)
        conversationData.participantIds = [...allParticipantIds]
          .sort()
          .map((id) => new Types.ObjectId(id));
      }

      // Store client contact info for display
      if (clientContact) {
        conversationData.clientContact = clientContact;
      }
    } else {
      // Sort and store participantIds for dm/group_dm
      // Ensure createdBy is included in participantIds
      const createdByStr = createdBy.toString();
      const participantIdStrs = participantIds.map((id) => id.toString());
      const allParticipantIds = participantIdStrs.includes(createdByStr)
        ? participantIdStrs
        : [...participantIdStrs, createdByStr];

      conversationData.participantIds = [...allParticipantIds]
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
    created = true;
  }

  return { conversation, created };
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
      "participants.userId": new Types.ObjectId(userId),
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

/**
 * Sync channel conversation participants with channel members
 * Used when channel members are added/removed
 * @param {String} channelId - Channel ID
 * @param {Array} memberIds - Array of user IDs (current channel members)
 */
exports.syncChannelParticipants = async (channelId, memberIds) => {
  const conversation = await ChatConversation.findOne({
    channelId,
    type: "channel",
  });

  if (!conversation) {
    console.warn(`No conversation found for channel ${channelId}`);
    return null;
  }

  // Get current participant user IDs
  const currentParticipantIds = conversation.participants.map((p) =>
    p.userId.toString()
  );

  // Convert memberIds to strings for comparison
  const newMemberIds = memberIds.map((id) => id.toString());

  // Find users to add (in memberIds but not in participants)
  const toAdd = newMemberIds.filter(
    (id) => !currentParticipantIds.includes(id)
  );

  // Find users to remove (in participants but not in memberIds)
  const toRemove = currentParticipantIds.filter(
    (id) => !newMemberIds.includes(id)
  );

  // Build update operations
  const updates = {};

  if (toAdd.length > 0) {
    updates.$push = {
      participants: {
        $each: toAdd.map((userId) => ({
          userId: new Types.ObjectId(userId),
          lastReadAt: null,
        })),
      },
    };
  }

  if (toRemove.length > 0) {
    updates.$pull = {
      participants: {
        userId: { $in: toRemove.map((id) => new Types.ObjectId(id)) },
      },
    };
  }

  // If no changes needed, return conversation as-is
  if (Object.keys(updates).length === 0) {
    return conversation;
  }

  // Apply updates
  return ChatConversation.findByIdAndUpdate(conversation._id, updates, {
    new: true,
  });
};

/**
 * Add a single user to channel conversation participants
 * @param {String} channelId - Channel ID
 * @param {String} userId - User ID to add
 */
exports.addChannelParticipant = async (channelId, userId) => {
  const conversation = await ChatConversation.findOne({
    channelId,
    type: "channel",
  });

  if (!conversation) {
    console.warn(`No conversation found for channel ${channelId}`);
    return null;
  }

  // Check if user already exists in participants
  const exists = conversation.participants.some(
    (p) => p.userId.toString() === userId.toString()
  );

  if (exists) {
    return conversation; // Already a participant
  }

  return ChatConversation.findByIdAndUpdate(
    conversation._id,
    {
      $push: {
        participants: {
          userId: new Types.ObjectId(userId),
          lastReadAt: null,
        },
      },
    },
    { new: true }
  );
};

/**
 * Remove a single user from channel conversation participants
 * @param {String} channelId - Channel ID
 * @param {String} userId - User ID to remove
 */
exports.removeChannelParticipant = async (channelId, userId) => {
  const conversation = await ChatConversation.findOne({
    channelId,
    type: "channel",
  });

  if (!conversation) {
    console.warn(`No conversation found for channel ${channelId}`);
    return null;
  }

  return ChatConversation.findByIdAndUpdate(
    conversation._id,
    {
      $pull: {
        participants: { userId: new Types.ObjectId(userId) },
      },
    },
    { new: true }
  );
};

// ==================== Validation Helper Functions ====================

/**
 * Check if a phone number is already used in another client conversation in the same channel
 * @param {String} phoneNumber - Phone number in E.164 format (e.g., +1234567890)
 * @param {String} channelId - Channel ID
 * @param {String} companyId - Company ID
 * @param {String} excludeConversationId - Optional conversation ID to exclude (for updates)
 * @returns {Promise<Object>} { available: Boolean, existingConversation: Object|null }
 */
exports.isPhoneNumberAvailable = async (
  phoneNumber,
  channelId,
  companyId,
  excludeConversationId = null
) => {
  const query = {
    companyId,
    channelId,
    type: "client",
    $or: [
      { "externalContacts.whatsappE164s": phoneNumber },
      { "externalContacts.phoneE164s": phoneNumber },
    ],
  };

  // Exclude current conversation if updating
  if (excludeConversationId) {
    query._id = { $ne: excludeConversationId };
  }

  const existingConversation = await ChatConversation.findOne(query);

  return {
    available: !existingConversation,
    existingConversation: existingConversation || null,
  };
};

/**
 * Check if an email is already used in another client conversation in the same channel
 * @param {String} email - Email address
 * @param {String} channelId - Channel ID
 * @param {String} companyId - Company ID
 * @param {String} excludeConversationId - Optional conversation ID to exclude (for updates)
 * @returns {Promise<Object>} { available: Boolean, existingConversation: Object|null }
 */
exports.isEmailAvailable = async (
  email,
  channelId,
  companyId,
  excludeConversationId = null
) => {
  const query = {
    companyId,
    channelId,
    type: "client",
    "externalContacts.emails": email.toLowerCase(),
  };

  // Exclude current conversation if updating
  if (excludeConversationId) {
    query._id = { $ne: excludeConversationId };
  }

  const existingConversation = await ChatConversation.findOne(query);

  return {
    available: !existingConversation,
    existingConversation: existingConversation || null,
  };
};

/**
 * Validate multiple phone numbers for uniqueness in channel
 * @param {Array<String>} phoneNumbers - Array of phone numbers
 * @param {String} channelId - Channel ID
 * @param {String} companyId - Company ID
 * @param {String} excludeConversationId - Optional conversation ID to exclude
 * @returns {Promise<Object>} { valid: Boolean, duplicates: Array<{number, conversationId}> }
 */
exports.validatePhoneNumbers = async (
  phoneNumbers,
  channelId,
  companyId,
  excludeConversationId = null
) => {
  const duplicates = [];

  for (const phoneNumber of phoneNumbers) {
    const { available, existingConversation } = await exports.isPhoneNumberAvailable(
      phoneNumber,
      channelId,
      companyId,
      excludeConversationId
    );

    if (!available) {
      duplicates.push({
        number: phoneNumber,
        conversationId: existingConversation._id,
      });
    }
  }

  return {
    valid: duplicates.length === 0,
    duplicates,
  };
};

/**
 * Validate multiple emails for uniqueness in channel
 * @param {Array<String>} emails - Array of email addresses
 * @param {String} channelId - Channel ID
 * @param {String} companyId - Company ID
 * @param {String} excludeConversationId - Optional conversation ID to exclude
 * @returns {Promise<Object>} { valid: Boolean, duplicates: Array<{email, conversationId}> }
 */
exports.validateEmails = async (
  emails,
  channelId,
  companyId,
  excludeConversationId = null
) => {
  const duplicates = [];

  for (const email of emails) {
    const { available, existingConversation } = await exports.isEmailAvailable(
      email,
      channelId,
      companyId,
      excludeConversationId
    );

    if (!available) {
      duplicates.push({
        email,
        conversationId: existingConversation._id,
      });
    }
  }

  return {
    valid: duplicates.length === 0,
    duplicates,
  };
};
