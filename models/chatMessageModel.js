"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

// Attachment metadata subdocument schema
const attachmentMetaSchema = new Schema(
  {
    url: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["image", "document", "audio", "video", "gif"],
      required: true,
    },
    fileName: {
      type: String,
    },
    fileSize: {
      type: Number, // bytes
    },
    mimeType: {
      type: String,
    },
    // Audio/Video specific
    duration: {
      type: Number, // seconds
    },
    waveform: [
      {
        type: Number, // amplitude values for audio visualization
      },
    ],
    // Image/Video specific
    width: {
      type: Number, // pixels
    },
    height: {
      type: Number, // pixels
    },
  },
  { _id: false }
);

// Delivery status subdocument schema for client chat multi-channel delivery
const deliverySchema = new Schema(
  {
    channel: {
      type: String,
      enum: ["board", "email", "whatsapp", "sms"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "queued", "sent", "delivered", "failed"],
      default: "pending",
    },
    provider: {
      type: String,
      enum: ["nodemailer", "sendgrid", "twilio", "internal"],
    },
    providerMessageId: {
      type: String,
    },
    error: {
      type: String,
    },
    sentAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
  },
  { _id: false }
);

const chatMessageSchema = new Schema(
  {
    companyId: {
      type: Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    conversationId: {
      type: Types.ObjectId,
      ref: "ChatConversation",
      required: true,
      index: true,
    },
    authorId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Rich text content in TipTap JSON format
    contentDoc: {
      type: Schema.Types.Mixed,
      required: true,
    },
    // Derived plaintext for search and previews
    contentText: {
      type: String,
      default: "",
    },
    // S3 URLs for attachments
    attachmentsUrls: [
      {
        type: String,
      },
    ],
    // Rich metadata for attachments
    attachmentsMeta: [attachmentMetaSchema],
    // Extracted URLs from link marks
    links: [
      {
        type: String,
      },
    ],
    // Client-side message ID for idempotency
    clientMsgId: {
      type: String,
      sparse: true,
    },
    // Message editing
    editedAt: {
      type: Date,
      default: null,
    },
    // Soft delete
    deletedAt: {
      type: Date,
      default: null,
    },
    // Threading - parent message for replies
    parentMessageId: {
      type: Types.ObjectId,
      ref: "ChatMessage",
      default: null,
      index: true,
    },
    // Thread aggregates (only on root messages where parentMessageId is null)
    replyCount: {
      type: Number,
      default: 0,
    },
    lastReplyAt: {
      type: Date,
      default: null,
    },
    lastReplyText: {
      type: String,
      default: "",
      maxlength: 200,
    },
    lastReplyAuthorId: {
      type: Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Thread participants (users who have replied to this thread)
    threadParticipants: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
    // Client chat multi-channel delivery tracking
    deliveries: [deliverySchema],
    // Message direction (for client chat)
    direction: {
      type: String,
      enum: ["outbound", "inbound"],
      default: "outbound",
    },
    // Sender role (for client chat)
    senderRole: {
      type: String,
      enum: ["team", "client"],
      default: "team",
    },
    // Inbound message sender contact info (phone/email for display)
    senderContactInfo: {
      type: String,
    },
    // Inbound message channel (for displaying author with channel label)
    senderChannel: {
      type: String,
      enum: ["sms", "email", "whatsapp"],
    },
    // Email subject (required when email in deliveries)
    emailSubject: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance

// 1. Main pagination index (newest first)
chatMessageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

// 2. Cursor stability
chatMessageSchema.index({ companyId: 1, conversationId: 1, _id: 1 });

// 3. Idempotency check (prevent duplicate client messages)
chatMessageSchema.index(
  { conversationId: 1, authorId: 1, clientMsgId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { clientMsgId: { $exists: true } } }
);

// 4. Thread pagination
chatMessageSchema.index({ conversationId: 1, parentMessageId: 1, createdAt: 1, _id: 1 });

// 5. Content search (text index)
chatMessageSchema.index({ contentText: "text" });

// 6. Delivery channel lookups (for client chat delivery tracking)
chatMessageSchema.index({ "deliveries.channel": 1, createdAt: -1 });

// 6. Author's messages
chatMessageSchema.index({ authorId: 1, createdAt: -1 });

// 7. Thread participants lookups (for thread notification queries)
chatMessageSchema.index({ _id: 1, threadParticipants: 1 });

// Register plugins
chatMessageSchema.plugin(mongoosePaginate);
chatMessageSchema.plugin(aggregatePaginate);

const ChatMessage = model("ChatMessage", chatMessageSchema);

// ==================== CRUD Helper Functions ====================

// Create a new message
exports.createChatMessage = (messageData) => ChatMessage.create(messageData);

// Find a single message
exports.findChatMessage = (query) => ChatMessage.findOne(query);

// Find multiple messages
exports.findManyChatMessages = (query) => ChatMessage.find(query);

// Update a message
exports.updateChatMessage = (query, update, options = {}) =>
  ChatMessage.findOneAndUpdate(query, update, { new: true, ...options });

// Delete a message (hard delete - use with caution)
exports.deleteChatMessage = (query) => ChatMessage.findOneAndDelete(query);

// Count messages
exports.countChatMessages = (query) => ChatMessage.countDocuments(query);

// Get paginated messages
exports.getAllChatMessages = async ({
  query,
  page = 1,
  limit = 50,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: ChatMessage,
    query,
    page,
    limit,
  });

  return { [responseKey]: data, pagination };
};

// Aggregate messages (for complex queries)
exports.aggregateChatMessages = (pipeline) => ChatMessage.aggregate(pipeline);

// ==================== Specialized Helper Functions ====================

/**
 * Get messages with cursor-based pagination
 * @param {Object} params - { conversationId, cursor?, limit?, parentMessageId?, sortDirection? }
 * @returns {Promise<Object>} { messages: [], nextCursor: string|null }
 */
exports.getMessagesCursor = async ({
  conversationId,
  cursor = null,
  limit = 50,
  parentMessageId = null,
  sortDirection = "desc", // 'desc' for newest first, 'asc' for oldest first
}) => {
  const query = {
    conversationId,
    parentMessageId: parentMessageId || null, // null = root messages only
  };

  // Parse cursor if provided
  if (cursor) {
    try {
      const [createdAt, _id] = cursor.split(".");
      const cursorDate = new Date(createdAt);

      if (sortDirection === "desc") {
        // Newer messages (scroll down)
        query.$or = [
          { createdAt: { $lt: cursorDate } },
          { createdAt: cursorDate, _id: { $lt: new Types.ObjectId(_id) } },
        ];
      } else {
        // Older messages (scroll up)
        query.$or = [
          { createdAt: { $gt: cursorDate } },
          { createdAt: cursorDate, _id: { $gt: new Types.ObjectId(_id) } },
        ];
      }
    } catch (error) {
      throw new Error("Invalid cursor format");
    }
  }

  const messages = await ChatMessage.find(query)
    .sort({ createdAt: sortDirection === "desc" ? -1 : 1, _id: sortDirection === "desc" ? -1 : 1 })
    .limit(limit + 1) // Fetch one extra to check if there's more
    .populate("authorId", "name email image")
    .populate("lastReplyAuthorId", "name email image")
    .lean();

  // Check if there are more messages
  const hasMore = messages.length > limit;
  const resultMessages = hasMore ? messages.slice(0, limit) : messages;

  // Generate next cursor
  let nextCursor = null;
  if (hasMore) {
    const lastMessage = resultMessages[resultMessages.length - 1];
    nextCursor = `${lastMessage.createdAt.toISOString()}.${lastMessage._id}`;
  }

  return {
    messages: resultMessages,
    nextCursor,
    hasMore,
  };
};

/**
 * Soft delete a message
 * @param {String} messageId
 * @param {String} userId - For authorization check
 * @returns {Promise<Object>} Updated message
 */
exports.softDeleteMessage = async (messageId, userId) => {
  const message = await ChatMessage.findById(messageId);

  if (!message) {
    throw new Error("Message not found");
  }

  if (message.authorId.toString() !== userId.toString()) {
    throw new Error("Only the author can delete this message");
  }

  if (message.deletedAt) {
    throw new Error("Message already deleted");
  }

  // Soft delete: set deletedAt and replace content
  const deletedContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "[Message deleted]",
          },
        ],
      },
    ],
  };

  return ChatMessage.findByIdAndUpdate(
    messageId,
    {
      deletedAt: new Date(),
      contentDoc: deletedContent,
      contentText: "[Message deleted]",
      attachmentsUrls: [],
      attachmentsMeta: [],
      links: [],
    },
    { new: true }
  );
};

/**
 * Edit a message
 * @param {String} messageId
 * @param {String} userId - For authorization check
 * @param {Object} updates - { contentDoc, attachmentsUrls?, attachmentsMeta? }
 * @returns {Promise<Object>} Updated message
 */
exports.editMessage = async (messageId, userId, updates) => {
  const message = await ChatMessage.findById(messageId);

  if (!message) {
    throw new Error("Message not found");
  }

  if (message.authorId.toString() !== userId.toString()) {
    throw new Error("Only the author can edit this message");
  }

  if (message.deletedAt) {
    throw new Error("Cannot edit deleted message");
  }

  const updateData = {
    contentDoc: updates.contentDoc,
    editedAt: new Date(),
  };

  if (updates.contentText) {
    updateData.contentText = updates.contentText;
  }

  if (updates.attachmentsUrls !== undefined) {
    updateData.attachmentsUrls = updates.attachmentsUrls;
  }

  if (updates.attachmentsMeta !== undefined) {
    updateData.attachmentsMeta = updates.attachmentsMeta;
  }

  if (updates.links !== undefined) {
    updateData.links = updates.links;
  }

  return ChatMessage.findByIdAndUpdate(messageId, updateData, { new: true });
};

/**
 * Update thread aggregates on root message when a reply is added
 * @param {String} rootMessageId
 * @param {Object} replyData - { replyText, replyAuthorId }
 */
exports.incrementThreadCount = async (rootMessageId, replyData) => {
  const { replyText = "", replyAuthorId } = replyData;

  return ChatMessage.findByIdAndUpdate(
    rootMessageId,
    {
      $inc: { replyCount: 1 },
      $set: {
        lastReplyAt: new Date(),
        lastReplyText: replyText.substring(0, 200),
        lastReplyAuthorId: replyAuthorId,
      },
      $addToSet: {
        threadParticipants: replyAuthorId, // Add reply author to thread participants (no duplicates)
      },
    },
    { new: true }
  );
};

/**
 * Decrement thread count (when reply is deleted)
 * @param {String} rootMessageId
 */
exports.decrementThreadCount = async (rootMessageId) => {
  const message = await ChatMessage.findById(rootMessageId);
  if (!message) return null;

  const newCount = Math.max(0, (message.replyCount || 0) - 1);

  // If no more replies, clear thread aggregates
  if (newCount === 0) {
    return ChatMessage.findByIdAndUpdate(
      rootMessageId,
      {
        replyCount: 0,
        lastReplyAt: null,
        lastReplyText: "",
        lastReplyAuthorId: null,
      },
      { new: true }
    );
  }

  // Otherwise, just decrement
  return ChatMessage.findByIdAndUpdate(
    rootMessageId,
    {
      $inc: { replyCount: -1 },
    },
    { new: true }
  );
};

/**
 * Search messages by text
 * @param {Object} params - { companyId, conversationId?, query, limit? }
 * @returns {Promise<Array>} Matching messages
 */
exports.searchMessages = async ({ companyId, conversationId, query, limit = 20 }) => {
  const searchQuery = {
    companyId,
    $text: { $search: query },
    deletedAt: null, // Exclude deleted messages
  };

  if (conversationId) {
    searchQuery.conversationId = conversationId;
  }

  return ChatMessage.find(searchQuery)
    .sort({ score: { $meta: "textScore" }, createdAt: -1 })
    .limit(limit)
    .populate("authorId", "name email image")
    .lean();
};

/**
 * Get message with full details (author, reply info)
 * @param {String} messageId
 * @returns {Promise<Object>} Message with populated fields
 */
exports.getMessageWithDetails = async (messageId) => {
  return ChatMessage.findById(messageId)
    .populate("authorId", "name email image")
    .populate("lastReplyAuthorId", "name email image")
    .lean();
};

/**
 * Check if message exists and user has access
 * @param {String} messageId
 * @param {String} conversationId
 * @returns {Promise<Boolean>}
 */
exports.hasMessageAccess = async (messageId, conversationId) => {
  const message = await ChatMessage.findOne({
    _id: messageId,
    conversationId,
  });
  return !!message;
};
