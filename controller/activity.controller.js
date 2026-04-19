"use strict";

const { generateResponse } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findProject } = require("../models/projectModel");
const { findTask } = require("../models/taskModel");
const {
  getProjectActivities,
  getTaskActivities,
} = require("../models/activityModel");
const { emitUnreadCountsUpdate } = require("../utils/socket");

/**
 * Get all activities for a project
 */
exports.getProjectActivities = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { page, limit } = req.query;

    // Check if project exists
    const project = await findProject({ _id: projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Check if user has access to project
    // This verification would depend on your access control system

    // Get activities
    const activities = await getProjectActivities({
      projectId,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });

    return generateResponse(
      activities,
      "Project activities fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getProjectActivities:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get all activities for a specific task
 */
exports.getTaskActivities = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { page, limit } = req.query;

    // Check if task exists
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    // Get activities
    const activities = await getTaskActivities({
      taskId,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });

    return generateResponse(
      activities,
      "Task activities fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getTaskActivities:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Format activity for display (helper function)
 * This could be used on the frontend or exposed as an API endpoint
 */
const formatActivityText = (activity) => {
  const { actionType, field, newValue, user } = activity;
  const userName = user?.name || "A user";

  switch (actionType) {
    case ACTION_TYPE.CREATE_TASK:
      return `${userName} created this task`;

    case ACTION_TYPE.UPDATE_TASK:
      switch (field) {
        case "title":
          return `${userName} changed the title to "${newValue}"`;
        case "description":
          return `${userName} updated the description`;
        case "status":
          return `${userName} changed the status to "${newValue}"`;
        case "priority":
          return `${userName} changed the priority to "${newValue}"`;
        case "dueDate":
          const date = new Date(newValue).toLocaleDateString();
          return `${userName} changed the due date to ${date}`;
        case "assignedTo":
          return `${userName} assigned the task to a user`;
        case "tags":
          return `${userName} updated the tags`;
        case "strokeColor":
          return `${userName} changed the color`;
        default:
          return `${userName} updated the task`;
      }

    case ACTION_TYPE.DELETE_TASK:
      return `${userName} deleted this task`;

    case ACTION_TYPE.CREATE_SUBTASK:
      return `${userName} created a subtask`;

    case ACTION_TYPE.UPDATE_SUBTASK:
      switch (field) {
        case "title":
          return `${userName} changed the subtask title to "${newValue}"`;
        case "status":
          return `${userName} changed the subtask status to "${newValue}"`;
        case "assignedTo":
          return `${userName} assigned the subtask to a user`;
        default:
          return `${userName} updated a subtask`;
      }

    case ACTION_TYPE.DELETE_SUBTASK:
      return `${userName} deleted a subtask`;

    default:
      return `${userName} performed an action`;
  }
};

// Export the helper function for use in frontend
exports.formatActivityText = formatActivityText;

// ==================== ACTIVITY FEED ENDPOINTS ====================

/**
 * Activity Feed Controller Functions
 * Handles API endpoints for fetching and managing activity feed notifications
 */

const { Types } = require("mongoose");
const { parseBody } = require("../utils");
const { model } = require("mongoose");
const {
  formatActivityItem,
  mapCategoryFilter,
  calculateUnreadCounts,
} = require("./helpers/activities/activity.helper");

/**
 * GET /api/notifications/feed
 * Get activity feed with filtering and pagination
 */
exports.getActivities = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, isRead, since, page, limit } = req.query;

    if (!userId) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    // Build filter query
    const filter = {
      userId: Types.ObjectId.isValid(userId)
        ? new Types.ObjectId(userId)
        : null,
    };

    const FEED_NOTIFICATION_TYPES = [
      "CHAT_MESSAGE",
      "CHAT_MENTION",
      "CHAT_THREAD_REPLY",
      "CHAT_REACTION",
      "CHANNEL_INVITATION",
      "TASK_COMMENT_MENTION",
    ];
    filter.type = { $in: FEED_NOTIFICATION_TYPES };

    // Apply category filter
    if (type && type !== "all") {
      const activityCategory = mapCategoryFilter(type);
      if (activityCategory) {
        filter.activityCategory = activityCategory;
      }
    }

    // Apply read status filter
    if (isRead !== undefined) {
      filter.isRead = isRead === "true" || isRead === true;
    }

    // Apply date filter (since)
    if (since) {
      try {
        const sinceDate = new Date(since);
        if (!isNaN(sinceDate.getTime())) {
          filter.timestamp = { $gte: sinceDate };
        }
      } catch (error) {
        console.error("Invalid since date:", error);
      }
    }

    // Build aggregation query
    const aggregationQuery = [
      { $match: filter },
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
          channelName: 1,
          conversationType: 1,
          reactionEmoji: 1,
          activityCategory: 1,
          conversationId: 1,
          messageId: 1,
          channelId: 1,
          projectId: 1,
          taskId: 1,
          commentId: 1,
          tabId: 1,
          creator: {
            _id: 1,
            name: 1,
            email: 1,
            image: 1,
          },
        },
      },
    ];

    // Get paginated results
    const { getMongooseAggregatePaginatedData } = require("../utils");
    const NotificationModel = model("Notification");

    const { data, pagination } = await getMongooseAggregatePaginatedData({
      model: NotificationModel,
      query: aggregationQuery,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      sort: { timestamp: -1 },
    });

    // Format activities
    const formattedActivities = data.map((notification) =>
      formatActivityItem(notification)
    );

    // Calculate unread count (same types as the feed filter)
    const unreadCount = await NotificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
      type: { $in: FEED_NOTIFICATION_TYPES },
    });

    return generateResponse(
      {
        activities: formattedActivities,
        pagination,
        unreadCount,
      },
      "Activities retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getActivities:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch activities",
    });
  }
};

/**
 * GET /api/notifications/feed/unread-counts
 * Get unread counts grouped by category
 */
exports.getUnreadCounts = async (req, res, next) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    const NotificationModel = model("Notification");
    const counts = await calculateUnreadCounts(NotificationModel, userId);

    return generateResponse(
      counts,
      "Unread counts retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUnreadCounts:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch unread counts",
    });
  }
};

/**
 * POST /api/notifications/feed/:activityId/mark-read
 * Mark a single activity as read
 */
exports.markActivityAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { activityId } = req.params;

    if (!activityId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Activity ID is required",
      });
    }

    if (!Types.ObjectId.isValid(activityId)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid activity ID",
      });
    }

    const NotificationModel = model("Notification");
    const notification = await NotificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(activityId),
        userId: new Types.ObjectId(userId),
      },
      { isRead: true },
      { new: true }
    ).populate("createdBy", "name email image");

    if (!notification) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Activity not found or you don't have permission to access it",
      });
    }

    // ========== Sync: Mark conversation as read if this is a chat message notification ==========
    // When user marks a CHAT_MESSAGE activity as read, also mark the conversation as read
    if (notification.type === "CHAT_MESSAGE" && notification.conversationId) {
      try {
        const { markAsRead } = require("../models/chatConversationModel");
        const { getIO } = require("../utils/socket");

        await markAsRead(
          notification.conversationId.toString(),
          userId,
          new Date()
        );

        // Emit chat unread update via socket
        const io = getIO();
        io.to(`user:${userId}`).emit("chat:unread:updated", {
          conversationId: notification.conversationId,
          unreadCount: 0,
        });
      } catch (chatSyncError) {
        console.error("Error syncing chat read status:", chatSyncError);
        // Don't fail the activity mark-as-read if chat sync fails
      }
    }

    const updatedCounts = await calculateUnreadCounts(
      NotificationModel,
      userId
    );

    // Emit real-time unread count update
    await emitUnreadCountsUpdate(userId);

    return generateResponse(
      {
        activity: formatActivityItem(notification, notification.createdBy),
        unreadCounts: updatedCounts,
      },
      "Activity marked as read",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in markActivityAsRead:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to mark activity as read",
    });
  }
};

/**
 * POST /api/notifications/feed/mark-all-read
 * Mark all activities (or by type) as read
 */
exports.markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type } = parseBody(req.body);

    if (!userId) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    const query = {
      userId: new Types.ObjectId(userId),
      isRead: false,
    };

    if (type && type !== "all") {
      const activityCategory = mapCategoryFilter(type);
      if (activityCategory) {
        query.activityCategory = activityCategory;
      }
    }

    const NotificationModel = model("Notification");

    // ========== Sync: Find affected conversations before bulk update ==========
    // Get distinct conversationIds for CHAT_MESSAGE notifications that will be marked as read
    const affectedConversationIds = await NotificationModel.distinct(
      "conversationId",
      {
        ...query,
        type: "CHAT_MESSAGE",
        conversationId: { $exists: true, $ne: null },
      }
    );

    const result = await NotificationModel.updateMany(query, {
      isRead: true,
    });

    // ========== Sync: Mark affected conversations as read ==========
    if (affectedConversationIds.length > 0) {
      try {
        const { markAsRead } = require("../models/chatConversationModel");
        const { getIO } = require("../utils/socket");
        const io = getIO();

        // Mark each conversation as read
        for (const conversationId of affectedConversationIds) {
          try {
            await markAsRead(conversationId.toString(), userId, new Date());

            // Emit chat unread update via socket
            io.to(`user:${userId}`).emit("chat:unread:updated", {
              conversationId: conversationId.toString(),
              unreadCount: 0,
            });
          } catch (convError) {
            console.error(
              `Error marking conversation ${conversationId} as read:`,
              convError
            );
            // Continue with other conversations
          }
        }
      } catch (chatSyncError) {
        console.error("Error syncing chat read status:", chatSyncError);
        // Don't fail the activity mark-all-as-read if chat sync fails
      }
    }

    const updatedCounts = await calculateUnreadCounts(
      NotificationModel,
      userId
    );

    // Emit real-time unread count update
    await emitUnreadCountsUpdate(userId);

    const message =
      type && type !== "all"
        ? `All ${type} marked as read`
        : "All activities marked as read";

    return generateResponse(
      {
        markedCount: result.modifiedCount,
        unreadCounts: updatedCounts,
      },
      message,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in markAllAsRead:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to mark activities as read",
    });
  }
};
