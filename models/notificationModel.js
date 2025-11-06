const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const notificationSchema = new Schema({
  // Who should see this notification
  userId: { type: Types.ObjectId, ref: "User", required: true },

  // Notification metadata
  type: {
    type: String,
    enum: [
      "MENTION",
      "CHANNEL",
      "WORK_IN_PROGRESS",
      "CHAT_MENTION",
      "CHAT_MESSAGE",
      "CHAT_THREAD_REPLY",
      "CHAT_REACTION",        // NEW: Emoji reactions to messages
      "CHANNEL_INVITATION"    // NEW: User invited to channel
    ],
    required: true,
  },

  // Context references
  projectId: { type: Types.ObjectId, ref: "Project" },
  channelId: { type: Types.ObjectId, ref: "Channel" },
  tabId: { type: Types.ObjectId, ref: "ChannelTab" },
  taskId: { type: Types.ObjectId, ref: "Task" },
  conversationId: { type: Types.ObjectId, ref: "ChatConversation" },
  messageId: { type: Types.ObjectId, ref: "ChatMessage" },

  // Who created this notification
  createdBy: { type: Types.ObjectId, ref: "User", required: true },

  // Content
  title: { type: String, required: true },
  message: { type: String, required: true },
  contextPath: { type: String }, // e.g. "Workspin Channel / Workspin Main Board"

  // Status
  isRead: { type: Boolean, default: false },

  timestamp: { type: Date, default: Date.now },

  // ========== Activity Feed Fields ==========

  // Channel context (denormalized for performance, avoid JOIN lookups)
  channelName: {
    type: String,
    // Populated when notification is created for channel-based activities
  },

  // Conversation context for chat notifications
  conversationType: {
    type: String,
    enum: ["channel", "dm", "group_dm", "client"],
    // Helps construct subtitle without querying conversation
  },

  // Reaction-specific data
  reactionEmoji: {
    type: String,
    // For CHAT_REACTION type - stores emoji (e.g., "👍", "❤️")
  },

  // Activity categorization for filtering (REQUIRED for new notifications)
  activityCategory: {
    type: String,
    enum: ["chat", "mention", "reaction", "invitation", "task", "channel"],
    index: true, // Indexed for efficient filtering

    // IMPORTANT: Two separate notification systems use this field:

    // 1. CHAT/MESSAGING Activity Feed (created by chatSocket.js):
    //    - "chat" → CHAT_MESSAGE, CHAT_THREAD_REPLY
    //    - "mention" → CHAT_MENTION
    //    - "reaction" → CHAT_REACTION
    //    - "invitation" → CHANNEL_INVITATION

    // 2. TASK Notifications (created by task.controller.js, subtask.controller.js):
    //    - "task" → MENTION, WORK_IN_PROGRESS (task assignments)
    //    - "channel" → CHANNEL (task creation notifications)

    // These systems are SEPARATE and should NOT be mixed in queries.
    // Activity feed endpoints MUST filter by notification type to exclude task notifications.
  },

  // ========== Future: Aggregation Support (Optional) ==========

  aggregationKey: {
    type: String,
    index: true,
    // Format: "reaction:{messageId}:{emoji}"
    // Allows grouping: "John, Sarah, and 3 others reacted 👍"
  },

  aggregationCount: {
    type: Number,
    default: 1,
    // Number of similar activities aggregated
  },

  aggregatedActors: [
    {
      type: Types.ObjectId,
      ref: "User",
      // First N actors for "John and 3 others" display
    },
  ],
});

notificationSchema.plugin(mongoosePaginate);
notificationSchema.plugin(aggregatePaginate);

const NotificationModel = model("Notification", notificationSchema);

// Create notification
exports.createNotification = (obj) => NotificationModel.create(obj);

// Find notifications
exports.findNotification = (query) => NotificationModel.findOne(query);

// Get notifications for a user
exports.getUserNotifications = async ({ userId, type, page, limit }) => {
  const query = [
    {
      $match: {
        userId: Types.ObjectId.isValid(userId)
          ? new Types.ObjectId(userId)
          : null,
        ...(type && { type }),
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        type: 1,
        title: 1,
        message: 1,
        contextPath: 1,
        isRead: 1,
        timestamp: 1,
        // Activity feed fields
        channelName: 1,
        conversationType: 1,
        reactionEmoji: 1,
        activityCategory: 1,
        // Context references for navigation
        conversationId: 1,
        messageId: 1,
        channelId: 1,
        projectId: 1,
        taskId: 1,
        creator: {
          _id: 1,
          name: 1,
          email: 1,
          image: 1, // Include image for avatar display
        },
      },
    },
    { $sort: { timestamp: -1 } },
  ];

  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: NotificationModel,
    query,
    page: page || 1,
    limit: limit || 20,
  });

  return { notifications: data, pagination };
};

// Mark notification as read
exports.markAsRead = (notificationId) =>
  NotificationModel.findByIdAndUpdate(
    notificationId,
    { isRead: true },
    { new: true }
  );
