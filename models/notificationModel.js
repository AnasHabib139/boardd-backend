const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

const notificationSchema = new Schema({
  // Who should see this notification
  userId: { type: Types.ObjectId, ref: "User", required: true },

  // Notification metadata
  type: {
    type: String,
    enum: ["MENTION", "CHANNEL", "WORK_IN_PROGRESS", "CHAT_MENTION", "CHAT_MESSAGE", "CHAT_THREAD_REPLY"],
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
});

notificationSchema.plugin(mongoosePaginate);

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
        creator: {
          _id: 1,
          name: 1,
          email: 1,
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
