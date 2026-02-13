"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findTask } = require("../models/taskModel");
const { findProject } = require("../models/projectModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const { createTaskComment, findTaskComment, getAllTaskComments, deleteTaskComment: removeTaskComment } = require("../models/taskCommentModel");
const { createActivity } = require("../models/activityModel");
const { emitTaskEvent } = require("../utils/socket");

/**
 * Create a new comment on a task
 * User must be a tab or channel member to comment
 */
exports.createTaskComment = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { message, attachments, links } = parseBody(req.body);
    const userId = req.user.id;

    // Find task
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    // Get user
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get context - tab, project, and channel for permission checks
    let project = null;
    let tab = null;
    let channel = null;

    if (task.projectId) {
      // Project-based task
      project = await findProject({ _id: task.projectId });
      if (!project) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }

      [tab, channel] = await Promise.all([
        findChannelTab({ _id: project.tabId }),
        findChannel({ _id: project.channelId }),
      ]);

      if (!tab || !channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab or channel not found",
        });
      }
    } else if (task.channelId) {
      // Channel-based task (Open task)
      channel = await findChannel({ _id: task.channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Get tab from task
      if (task.tabId) {
        tab = await findChannelTab({ _id: task.tabId });
      }
    } else {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Task has no project or channel association",
      });
    }

    // Check permissions: user must be tab or channel member
    const isTabMember = tab && tab.members.some(id => id.toString() === userId);
    const isChannelMember = channel.members.some(id => id.toString() === userId);

    if (!isTabMember && !isChannelMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You must be a tab or channel member to comment on this task",
      });
    }

    // Create comment
    const comment = await createTaskComment({
      taskId,
      userId,
      message: message || "",
      attachments: attachments || [],
      links: links || [],
    });

    // Populate user details
    const populatedComment = await findTaskComment({ _id: comment._id })
      .populate("userId", "name email image coverImage");

    // Create activity
    const userName = user.name || user.email;
    const contextPath = project
      ? `${channel.channelName} / ${tab.tabName} / ${project.name}`
      : tab
      ? `${channel.channelName} / ${tab.tabName} / Open`
      : `${channel.channelName} / Open`;

    const activity = await createActivity({
      taskId: task._id,
      userId,
      actionType: ACTION_TYPE.ADD_COMMENT,
      message: {
        forCreator: `You added a comment to "${task.title}"`,
        forOthers: `${userName} added a comment to "${task.title}"`,
      },
      timestamp: new Date(),
      projectId: task.projectId || null,
      channelId: task.channelId || null,
    });

    // Emit socket event for real-time updates
    try {
      emitTaskEvent({
        taskId: task._id,
        channelId: channel._id,
        type: "TASK_COMMENT_ADDED",
        payload: {
          comment: populatedComment,
          task: {
            _id: task._id,
            title: task.title,
          },
          commentedBy: {
            _id: user._id,
            name: user.name,
            email: user.email,
          },
          activity,
          contextPath,
        },
      });
    } catch (socketError) {
      console.error("Error emitting comment socket event:", socketError);
      // Continue even if socket fails
    }

    return generateResponse(
      { comment: populatedComment },
      "Comment added successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createTaskComment:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete a comment on a task
 * Only the comment author can delete their own comment
 */
exports.deleteTaskComment = async (req, res, next) => {
  try {
    const { taskId, commentId } = req.params;
    const userId = req.user.id;

    // Find the comment and verify it belongs to the task
    const comment = await findTaskComment({ _id: commentId, taskId });
    if (!comment) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Comment not found",
      });
    }

    // Verify the requesting user is the comment author
    if (comment.userId.toString() !== userId) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only delete your own comments",
      });
    }

    // Find task for socket event context
    const task = await findTask({ _id: taskId });

    // Hard delete the comment
    await removeTaskComment({ _id: commentId });

    // Emit socket event for real-time updates
    try {
      emitTaskEvent({
        taskId,
        channelId: task?.channelId || task?.projectId,
        type: "TASK_COMMENT_DELETED",
        payload: {
          commentId,
          taskId,
          deletedBy: userId,
        },
      });
    } catch (socketError) {
      console.error("Error emitting comment delete socket event:", socketError);
    }

    return generateResponse(
      { commentId },
      "Comment deleted successfully",
      res
    );
  } catch (error) {
    console.error("Error in deleteTaskComment:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get all comments for a specific task
 * User must be a tab or channel member to view comments
 */
exports.getTaskComments = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    // Find task
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    // Get context - tab, project, and channel for permission checks
    let project = null;
    let tab = null;
    let channel = null;

    if (task.projectId) {
      // Project-based task
      project = await findProject({ _id: task.projectId });
      if (!project) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }

      [tab, channel] = await Promise.all([
        findChannelTab({ _id: project.tabId }),
        findChannel({ _id: project.channelId }),
      ]);

      if (!tab || !channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab or channel not found",
        });
      }
    } else if (task.channelId) {
      // Channel-based task (Open task)
      channel = await findChannel({ _id: task.channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Get tab from task
      if (task.tabId) {
        tab = await findChannelTab({ _id: task.tabId });
      }
    } else {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Task has no project or channel association",
      });
    }

    // Check permissions: user must be tab or channel member
    const isTabMember = tab && tab.members.some(id => id.toString() === userId);
    const isChannelMember = channel.members.some(id => id.toString() === userId);

    if (!isTabMember && !isChannelMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You must be a tab or channel member to view comments on this task",
      });
    }

    // Build aggregation query
    const query = [
      {
        $match: {
          taskId: require("mongoose").Types.ObjectId.createFromHexString(taskId),
          isActive: true,
        },
      },
      // Lookup user details
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Project fields
      {
        $project: {
          _id: 1,
          taskId: 1,
          message: 1,
          attachments: 1,
          links: 1,
          createdAt: 1,
          updatedAt: 1,
          user: {
            _id: "$user._id",
            name: "$user.name",
            email: "$user.email",
            image: "$user.image",
            coverImage: "$user.coverImage",
            title: "$user.title",
            designation: "$user.designation",
          },
        },
      },
      // Sort by most recent first
      {
        $sort: { createdAt: -1 },
      },
    ];

    // Get paginated comments
    const { comments, pagination } = await getAllTaskComments({
      query,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    return generateResponse(
      { comments, pagination },
      "Comments retrieved successfully",
      res
    );
  } catch (error) {
    console.error("Error in getTaskComments:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
