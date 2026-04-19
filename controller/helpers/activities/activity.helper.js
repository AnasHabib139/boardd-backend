"use strict";

/**
 * Activity Feed Helper Functions
 * Provides utility functions for formatting and categorizing activity feed notifications
 */

/**
 * Map notification type to activity category
 * IMPORTANT: Only for CHAT/MESSAGING notifications
 * Task notifications (MENTION, CHANNEL, WORK_IN_PROGRESS) are a separate system
 * @param {String} type - Notification type
 * @returns {String} Activity category
 */
exports.getActivityCategory = (type) => {
  const categoryMap = {
    CHAT_MESSAGE: "chat",
    CHAT_THREAD_REPLY: "chat",
    CHAT_MENTION: "mention",
    CHAT_REACTION: "reaction",
    CHANNEL_INVITATION: "invitation",
  };

  return categoryMap[type] || "chat";
};

/**
 * Generate subtitle for activity based on conversation context
 * @param {Object} notification - Notification object with metadata
 * @returns {String} Formatted subtitle
 */
exports.getActivitySubtitle = (notification) => {
  const { type, channelName, conversationType, reactionEmoji } = notification;

  // Reaction-specific subtitle
  if (type === "CHAT_REACTION") {
    if (channelName) {
      return `reaction in ${channelName}`;
    }
    switch (conversationType) {
      case "dm":
        return "reaction in Direct Message";
      case "group_dm":
        return "reaction in Group Chat";
      case "client":
        return "reaction in Client Chat";
      default:
        return "reaction";
    }
  }

  // Invitation-specific subtitle
  if (type === "CHANNEL_INVITATION") {
    return channelName ? `invited to ${channelName}` : "channel invitation";
  }

  // Regular message subtitle (CHAT_MESSAGE)
  if (type === "CHAT_MESSAGE") {
    if (channelName) {
      return `message in ${channelName}`;
    }
    switch (conversationType) {
      case "dm":
        return "Direct Message";
      case "group_dm":
        return "Group Message";
      case "client":
        return "Client Message";
      default:
        return "New message";
    }
  }

  // Chat/Mention subtitle with context (CHAT_MENTION, CHAT_THREAD_REPLY)
  if (channelName) {
    return `in ${channelName}`;
  }

  switch (conversationType) {
    case "dm":
      return "Direct Message";
    case "group_dm":
      return "Group Chat";
    case "client":
      return "Client Chat";
    case "channel":
      return "Channel";
    default:
      return "";
  }
};

/**
 * Format notification into activity feed item for frontend
 * @param {Object} notification - Notification object from DB
 * @param {Object} actor - User who created the notification (optional, may already be populated)
 * @returns {Object} Formatted activity item
 */
exports.formatActivityItem = (notification, actor = null) => {
  // Use populated creator if actor is not provided
  const notificationActor = actor || notification.creator;

  return {
    _id: notification._id,
    type: notification.type,
    activityCategory: notification.activityCategory,

    // Display content
    title: notification.title,
    message: notification.message,
    subtitle: exports.getActivitySubtitle(notification),

    // Actor information
    actor: notificationActor
      ? {
          _id: notificationActor._id,
          name: notificationActor.name,
          email: notificationActor.email,
          image: notificationActor.image,
        }
      : null,

    // Context-specific data
    reactionEmoji: notification.reactionEmoji || null,
    conversationType: notification.conversationType || null,
    channelName: notification.channelName || null,

    // Navigation context
    navigationContext: {
      conversationId: notification.conversationId || null,
      messageId: notification.messageId || null,
      channelId: notification.channelId || null,
      projectId: notification.projectId || null,
      taskId: notification.taskId || null,
      commentId: notification.commentId || null,
      tabId: notification.tabId || null,
    },

    // Metadata
    timestamp: notification.timestamp,
    isRead: notification.isRead,
    contextPath: notification.contextPath || null,
  };
};

/**
 * Categorize notifications into activity feed buckets
 * IMPORTANT: Only for CHAT/MESSAGING notifications
 * @param {Array} notifications - Array of notification objects
 * @returns {Object} Notifications grouped by category
 */
exports.categorizeActivities = (notifications) => {
  const categorized = {
    all: [],
    mentions: [],
    reactions: [],
    chat: [],
    invitations: [],
  };

  notifications.forEach((notification) => {
    const formatted = exports.formatActivityItem(notification);

    // Add to "all" bucket
    categorized.all.push(formatted);

    // Add to specific category bucket
    const category = notification.activityCategory || exports.getActivityCategory(notification.type);

    switch (category) {
      case "mention":
        categorized.mentions.push(formatted);
        break;
      case "reaction":
        categorized.reactions.push(formatted);
        break;
      case "chat":
        categorized.chat.push(formatted);
        break;
      case "invitation":
        categorized.invitations.push(formatted);
        break;
    }
  });

  return categorized;
};

/**
 * Map frontend category filter to database query
 * IMPORTANT: Only for CHAT/MESSAGING notifications
 * @param {String} categoryFilter - Frontend category (e.g., "mentions", "reactions")
 * @returns {String|null} Database activityCategory value, or null for "all"
 */
exports.mapCategoryFilter = (categoryFilter) => {
  const filterMap = {
    all: null, // No filter
    mentions: "mention",
    reactions: "reaction",
    chat: "chat",
    invitations: "invitation",
  };

  return filterMap[categoryFilter] !== undefined ? filterMap[categoryFilter] : null;
};

/**
 * Calculate unread counts by category
 * IMPORTANT: Only counts CHAT/MESSAGING notifications
 * @param {Object} NotificationModel - Mongoose model
 * @param {String} userId - User ID to query
 * @returns {Promise<Object>} Unread counts by category
 */
exports.calculateUnreadCounts = async (NotificationModel, userId) => {
  const { Types } = require("mongoose");

  const FEED_NOTIFICATION_TYPES = [
    'CHAT_MESSAGE',
    'CHAT_MENTION',
    'CHAT_THREAD_REPLY',
    'CHAT_REACTION',
    'CHANNEL_INVITATION',
  ];

  // Aggregate unread counts by category
  const counts = await NotificationModel.aggregate([
    {
      $match: {
        userId: new Types.ObjectId(userId),
        isRead: false,
        type: { $in: FEED_NOTIFICATION_TYPES },
      },
    },
    {
      $group: {
        _id: "$activityCategory",
        count: { $sum: 1 },
      },
    },
  ]);

  // Transform to friendly format
  const result = {
    total: 0,
    byCategory: {
      mentions: 0,
      reactions: 0,
      chat: 0,
      invitations: 0,
    },
  };

  counts.forEach((item) => {
    const category = item._id;
    const count = item.count;
    result.total += count;

    switch (category) {
      case "mention":
        result.byCategory.mentions = count;
        break;
      case "reaction":
        result.byCategory.reactions = count;
        break;
      case "chat":
        result.byCategory.chat = count;
        break;
      case "invitation":
        result.byCategory.invitations = count;
        break;
    }
  });

  return result;
};
