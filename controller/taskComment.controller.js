"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findTask } = require("../models/taskModel");
const { findProject } = require("../models/projectModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const {
  createTaskComment,
  findTaskComment,
  getAllTaskComments,
  updateTaskComment,
  deleteTaskComment: removeTaskComment,
} = require("../models/taskCommentModel");
const { createActivity } = require("../models/activityModel");
const { createNotification } = require("../models/notificationModel");
const { emitTaskEvent, getIO } = require("../utils/socket");
const { validateAndSanitize, extractMentions } = require("../services/chatContentValidator");
const { deriveContentText, extractLinks } = require("../services/chatContentProcessor");
const { sendPushIfNotMuted } = require("../services/pushNotificationService");

/**
 * Resolve task context (tab, project, channel) and check membership.
 * Shared by create, update, and get handlers.
 */
async function resolveTaskContext(task, userId, next) {
  let project = null;
  let tab = null;
  let channel = null;

  if (task.projectId) {
    project = await findProject({ _id: task.projectId });
    if (!project) {
      next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Project not found" });
      return null;
    }
    [tab, channel] = await Promise.all([
      findChannelTab({ _id: project.tabId }),
      findChannel({ _id: project.channelId }),
    ]);
    if (!tab || !channel) {
      next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Tab or channel not found" });
      return null;
    }
  } else if (task.channelId) {
    channel = await findChannel({ _id: task.channelId });
    if (!channel) {
      next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
      return null;
    }
    if (task.tabId) tab = await findChannelTab({ _id: task.tabId });
  } else {
    next({ statusCode: STATUS_CODES.BAD_REQUEST, message: "Task has no project or channel association" });
    return null;
  }

  const isTabMember = tab && tab.members.some((id) => id.toString() === userId);
  const isChannelMember = channel.members.some((id) => id.toString() === userId);
  if (!isTabMember && !isChannelMember) {
    next({ statusCode: STATUS_CODES.FORBIDDEN, message: "You must be a tab or channel member to comment on this task" });
    return null;
  }

  const contextPath = project
    ? `${channel.channelName} / ${tab.tabName} / ${project.name}`
    : tab
    ? `${channel.channelName} / ${tab.tabName} / Uncategorized`
    : `${channel.channelName} / Uncategorized`;

  return { project, tab, channel, contextPath };
}

/**
 * Send mention notifications to all mentioned users (skip self).
 * Used by both create and update — edit retriggers for all mentioned users.
 */
async function sendMentionNotifications(userMentions, task, comment, author, contextPath) {
  if (!userMentions || userMentions.length === 0) return;

  const io = getIO();

  for (const mentionedUserId of userMentions) {
    if (mentionedUserId.toString() === author._id.toString()) continue;

    try {
      const notification = await createNotification({
        userId: mentionedUserId,
        type: "TASK_COMMENT_MENTION",
        activityCategory: "mention",
        title: "New mention",
        message: `${author.name} mentioned you in a comment: ${comment.contentText.substring(0, 100)}`,
        taskId: task._id,
        commentId: comment._id,
        channelId: task.channelId || null,
        tabId: task.tabId || null,
        projectId: task.projectId || null,
        createdBy: author._id,
        contextPath: contextPath || null,
      });

      if (io) {
        io.to(`user:${mentionedUserId}`).emit("tab-activity", {
          type: "TASK_COMMENT_MENTION",
          notification: {
            title: "New mention",
            message: `${author.name} mentioned you in a comment on "${task.title}"`,
            icon: "💬",
            color: "info",
          },
          _id: notification._id,
          activityCategory: "mention",
          actor: {
            _id: author._id,
            name: author.name,
            email: author.email,
            image: author.image,
          },
          taskId: task._id,
          commentId: comment._id,
          channelId: task.channelId || null,
          tabId: task.tabId || null,
          projectId: task.projectId || null,
          timestamp: notification.timestamp,
          isRead: false,
        });
      }
      sendPushIfNotMuted(mentionedUserId, {
        title: `💬 ${author.name} mentioned you`,
        body: comment.contentText.substring(0, 100),
        icon: "/main-logo.svg",
        url: `/dashboard?task=${task._id}`,
        data: { taskId: task._id.toString(), commentId: comment._id.toString(), type: "COMMENT_MENTION" },
      }, task.channelId || null).catch(() => {});
    } catch (err) {
      console.error(`Error sending mention notification to user ${mentionedUserId}:`, err);
      // Non-fatal — continue with other mentions
    }
  }
}

/**
 * Create a new comment on a task
 */
exports.createTaskComment = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { contentDoc, attachments, links } = parseBody(req.body);
    const userId = req.user.id;

    const task = await findTask({ _id: taskId });
    if (!task) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task not found" });

    const user = await findUser({ _id: userId });
    if (!user) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });

    const ctx = await resolveTaskContext(task, userId, next);
    if (!ctx) return; // next() already called inside

    // Validate and sanitize TipTap contentDoc
    const { isValid, sanitized, errors } = validateAndSanitize(contentDoc);
    if (!isValid) {
      return next({ statusCode: STATUS_CODES.UNPROCESSABLE_ENTITY, message: errors.join(", ") });
    }

    const contentText = deriveContentText(sanitized);
    const autoLinks = extractLinks(sanitized);
    const mergedLinks = [...new Set([...autoLinks, ...(links || [])])];

    const comment = await createTaskComment({
      taskId,
      userId,
      contentDoc: sanitized,
      contentText,
      attachments: attachments || [],
      links: mergedLinks,
    });

    const populatedComment = await findTaskComment({ _id: comment._id })
      .populate("userId", "name email image coverImage");

    const userName = user.name || user.email;
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

    // Extract mentions before emitting so mentioned users can be excluded from the generic toast
    const { userMentions } = extractMentions(sanitized);

    try {
      emitTaskEvent({
        taskId: task._id,
        channelId: ctx.channel._id,
        type: "TASK_COMMENT_ADDED",
        // Exclude the commenter (already knows they posted) and mentioned users
        // (they get a targeted "mentioned you" activity:new instead)
        excludeUserIds: [userId, ...userMentions.map((id) => id.toString())],
        payload: {
          comment: populatedComment,
          task: { _id: task._id, title: task.title },
          commentedBy: { _id: user._id, name: user.name, email: user.email },
          activity,
          contextPath: ctx.contextPath,
        },
      });
    } catch (socketError) {
      console.error("Error emitting comment socket event:", socketError);
    }

    // Push to all involved users (creator + assignees), skipping commenter and mentioned users
    const mentionedSet = new Set(userMentions.map((id) => id.toString()));
    const involvedIds = new Set([
      task.createdBy.toString(),
      ...(task.assignedTo || []).map((id) => id.toString()),
    ]);
    for (const involvedId of involvedIds) {
      if (involvedId === userId) continue;        // skip commenter
      if (mentionedSet.has(involvedId)) continue; // they get the mention push instead
      sendPushIfNotMuted(involvedId, {
        title: `💬 New comment on "${task.title}"`,
        body: `${userName}: ${populatedComment.contentText.substring(0, 80)}`,
        icon: "/main-logo.svg",
        url: `/dashboard?task=${task._id}`,
        data: { taskId: task._id.toString(), commentId: comment._id.toString(), type: "TASK_COMMENT" },
      }, task.channelId || null).catch(() => {});
    }

    // Send mention notifications (non-fatal)
    await sendMentionNotifications(userMentions, task, populatedComment, user, ctx.contextPath);

    return generateResponse(
      { comment: populatedComment },
      "Comment added successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createTaskComment:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Update a comment on a task (only the author can edit)
 * Mention notifications are retriggered for all mentioned users in the updated comment.
 */
exports.updateTaskComment = async (req, res, next) => {
  try {
    const { taskId, commentId } = req.params;
    const { contentDoc, attachments, links } = parseBody(req.body);
    const userId = req.user.id;

    const comment = await findTaskComment({ _id: commentId, taskId });
    if (!comment) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Comment not found" });

    if (comment.userId.toString() !== userId) {
      return next({ statusCode: STATUS_CODES.FORBIDDEN, message: "You can only edit your own comments" });
    }

    const task = await findTask({ _id: taskId });
    if (!task) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task not found" });

    const user = await findUser({ _id: userId });
    if (!user) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });

    const ctx = await resolveTaskContext(task, userId, next);
    if (!ctx) return;

    const { isValid, sanitized, errors } = validateAndSanitize(contentDoc);
    if (!isValid) {
      return next({ statusCode: STATUS_CODES.UNPROCESSABLE_ENTITY, message: errors.join(", ") });
    }

    const contentText = deriveContentText(sanitized);
    const autoLinks = extractLinks(sanitized);
    const mergedLinks = [...new Set([...autoLinks, ...(links || [])])];

    const updatedComment = await updateTaskComment(
      { _id: commentId },
      { contentDoc: sanitized, contentText, attachments: attachments || [], links: mergedLinks, updatedAt: new Date() }
    );

    const populatedComment = await findTaskComment({ _id: updatedComment._id })
      .populate("userId", "name email image coverImage");

    // Extract mentions before emitting so mentioned users can be excluded from the generic toast
    const { userMentions } = extractMentions(sanitized);

    try {
      emitTaskEvent({
        taskId: task._id,
        channelId: ctx.channel._id,
        type: "TASK_COMMENT_UPDATED",
        // Exclude the commenter and mentioned users from the generic "edited a comment" toast
        excludeUserIds: [userId, ...userMentions.map((id) => id.toString())],
        payload: {
          comment: populatedComment,
          task: { _id: task._id, title: task.title },
          updatedBy: { _id: user._id, name: user.name, email: user.email },
          contextPath: ctx.contextPath,
        },
      });
    } catch (socketError) {
      console.error("Error emitting comment update socket event:", socketError);
    }

    // Retrigger mention notifications for all mentioned users in updated comment
    await sendMentionNotifications(userMentions, task, populatedComment, user, ctx.contextPath);

    return generateResponse(
      { comment: populatedComment },
      "Comment updated successfully",
      res
    );
  } catch (error) {
    console.error("Error in updateTaskComment:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Delete a comment on a task (only the author can delete)
 */
exports.deleteTaskComment = async (req, res, next) => {
  try {
    const { taskId, commentId } = req.params;
    const userId = req.user.id;

    const comment = await findTaskComment({ _id: commentId, taskId });
    if (!comment) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Comment not found" });

    if (comment.userId.toString() !== userId) {
      return next({ statusCode: STATUS_CODES.FORBIDDEN, message: "You can only delete your own comments" });
    }

    const task = await findTask({ _id: taskId });

    await removeTaskComment({ _id: commentId });

    try {
      emitTaskEvent({
        taskId,
        channelId: task?.channelId || task?.projectId,
        type: "TASK_COMMENT_DELETED",
        payload: { commentId, taskId, deletedBy: userId },
      });
    } catch (socketError) {
      console.error("Error emitting comment delete socket event:", socketError);
    }

    return generateResponse({ commentId }, "Comment deleted successfully", res);
  } catch (error) {
    console.error("Error in deleteTaskComment:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Get all comments for a specific task
 */
exports.getTaskComments = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;

    const task = await findTask({ _id: taskId });
    if (!task) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task not found" });

    // Enforce membership check only for authenticated users
    // Unauthenticated users (shared task links) can read comments freely
    if (userId) {
      const ctx = await resolveTaskContext(task, userId, next);
      if (!ctx) return;
    }

    const query = [
      {
        $match: {
          taskId: require("mongoose").Types.ObjectId.createFromHexString(taskId),
          isActive: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          taskId: 1,
          contentDoc: 1,
          contentText: 1,
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
      { $sort: { createdAt: -1 } },
    ];

    const { comments, pagination } = await getAllTaskComments({
      query,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    return generateResponse({ comments, pagination }, "Comments retrieved successfully", res);
  } catch (error) {
    console.error("Error in getTaskComments:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};
