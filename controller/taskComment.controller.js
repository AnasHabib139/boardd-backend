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
  recomputeThreadAggregates,
  findManyTaskComments,
  deleteManyTaskComments,
} = require("../models/taskCommentModel");
const {
  toggleReaction,
  getReactionsByComment,
  getReactionsGroupedByComments,
  removeAllReactionsForComments,
} = require("../models/taskCommentReactionModel");
const { createActivity } = require("../models/activityModel");
const { createNotification, deleteManyNotifications } = require("../models/notificationModel");
const { emitTaskEvent, getIO } = require("../utils/socket");
const { validateAndSanitize, extractMentions } = require("../services/chatContentValidator");
const { deriveContentText, extractLinks } = require("../services/chatContentProcessor");
const { sendPushIfNotMuted, isUserMuted } = require("../services/pushNotificationService");

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
        data: { taskId: task._id.toString(), commentId: comment._id.toString(), channelId: task.channelId ? task.channelId.toString() : null, type: "COMMENT_MENTION" },
      }, task.channelId || null).catch(() => {});
    } catch (err) {
      console.error(`Error sending mention notification to user ${mentionedUserId}:`, err);
      // Non-fatal — continue with other mentions
    }
  }
}

/**
 * Notify the thread on a new reply: root author + threadParticipants,
 * minus the reply author and mentioned users (they get mention notifications).
 * Feed entry + activity:new are ALWAYS written; toast + push only when not muted.
 */
async function sendReplyNotifications({ rootComment, reply, task, author, contextPath, mentionedIds }) {
  const recipients = new Set([
    rootComment.userId.toString(),
    ...(rootComment.threadParticipants || []).map((id) => id.toString()),
  ]);
  recipients.delete(author._id.toString());
  for (const id of mentionedIds) recipients.delete(id.toString());
  if (recipients.size === 0) return;

  const io = getIO();
  const authorName = author.name || author.email;
  const preview = (reply.contentText || "").substring(0, 100);

  for (const recipientId of recipients) {
    try {
      const notification = await createNotification({
        userId: recipientId,
        type: "TASK_COMMENT_REPLY",
        activityCategory: "task",
        title: "New reply",
        message: `${authorName} replied: ${preview}`,
        taskId: task._id,
        commentId: reply._id,
        channelId: task.channelId || null,
        tabId: task.tabId || null,
        projectId: task.projectId || null,
        createdBy: author._id,
        contextPath: contextPath || null,
      });

      if (io) {
        // Always: live activity feed update
        io.to(`user:${recipientId}`).emit("activity:new", {
          _id: notification._id,
          type: "TASK_COMMENT_REPLY",
          activityCategory: "task",
          title: "New reply",
          messagePreview: `${authorName} replied: ${preview}`,
          actor: {
            _id: author._id,
            name: author.name,
            email: author.email,
            image: author.image,
          },
          taskId: task._id,
          commentId: reply._id,
          channelId: task.channelId || null,
          timestamp: notification.timestamp,
          isRead: false,
          navigationContext: {
            taskId: task._id,
            commentId: reply._id,
            channelId: task.channelId || null,
          },
        });
      }

      // Toast + push only when not muted (globally or for the task's channel)
      if (!(await isUserMuted(recipientId, task.channelId || null))) {
        if (io) {
          io.to(`user:${recipientId}`).emit("tab-activity", {
            type: "TASK_COMMENT_REPLY",
            notification: {
              title: "New reply",
              message: `${authorName} replied to a comment on "${task.title}"`,
              icon: "💬",
              color: "info",
            },
            _id: notification._id,
            activityCategory: "task",
            actor: {
              _id: author._id,
              name: author.name,
              email: author.email,
              image: author.image,
            },
            taskId: task._id,
            commentId: reply._id,
            channelId: task.channelId || null,
            tabId: task.tabId || null,
            projectId: task.projectId || null,
            timestamp: notification.timestamp,
            isRead: false,
          });
        }
        sendPushIfNotMuted(recipientId, {
          title: `💬 ${authorName} replied to a comment on "${task.title}"`,
          body: preview,
          icon: "/main-logo.svg",
          url: `/dashboard?task=${task._id}`,
          data: { taskId: task._id.toString(), commentId: reply._id.toString(), channelId: task.channelId ? task.channelId.toString() : null, type: "TASK_COMMENT_REPLY" },
        }, task.channelId || null).catch(() => {});
      }
    } catch (err) {
      console.error(`Error sending reply notification to user ${recipientId}:`, err);
      // Non-fatal — continue with other recipients
    }
  }
}

/**
 * Create a new comment on a task
 */
exports.createTaskComment = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { contentDoc, attachments, links, parentCommentId } = parseBody(req.body);
    const userId = req.user.id;

    const task = await findTask({ _id: taskId });
    if (!task) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task not found" });

    const user = await findUser({ _id: userId });
    if (!user) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });

    const ctx = await resolveTaskContext(task, userId, next);
    if (!ctx) return; // next() already called inside

    // Resolve reply target: single-level threads — replying to a reply flattens to its root
    let rootComment = null;
    if (parentCommentId) {
      const parent = await findTaskComment({ _id: parentCommentId, taskId, isActive: true });
      if (!parent) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Parent comment not found" });
      }
      rootComment = parent.parentCommentId
        ? await findTaskComment({ _id: parent.parentCommentId, taskId, isActive: true })
        : parent;
      if (!rootComment) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Parent comment not found" });
      }
    }

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
      parentCommentId: rootComment ? rootComment._id : null,
    });

    let updatedRoot = null;
    if (rootComment) {
      updatedRoot = await recomputeThreadAggregates(rootComment._id);
    }

    const populatedComment = await findTaskComment({ _id: comment._id })
      .populate("userId", "name email image coverImage");

    const userName = user.name || user.email;
    const activity = await createActivity({
      taskId: task._id,
      userId,
      actionType: ACTION_TYPE.ADD_COMMENT,
      message: {
        forCreator: rootComment
          ? `You replied to a comment on "${task.title}"`
          : `You added a comment to "${task.title}"`,
        forOthers: rootComment
          ? `${userName} replied to a comment on "${task.title}"`
          : `${userName} added a comment to "${task.title}"`,
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
          parentCommentId: rootComment ? rootComment._id : null,
          rootComment: updatedRoot
            ? {
                _id: updatedRoot._id,
                replyCount: updatedRoot.replyCount,
                threadParticipants: updatedRoot.threadParticipants,
              }
            : null,
        },
      });
    } catch (socketError) {
      console.error("Error emitting comment socket event:", socketError);
    }

    const mentionedSet = new Set(userMentions.map((id) => id.toString()));
    if (!rootComment) {
      // Root comment: push to all involved users (creator + assignees),
      // skipping commenter and mentioned users
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
          data: { taskId: task._id.toString(), commentId: comment._id.toString(), channelId: task.channelId ? task.channelId.toString() : null, type: "TASK_COMMENT" },
        }, task.channelId || null).catch(() => {});
      }
    } else {
      // Reply: targeted notifications to root author + thread participants
      await sendReplyNotifications({
        rootComment,
        reply: populatedComment,
        task,
        author: user,
        contextPath: ctx.contextPath,
        mentionedIds: userMentions,
      });
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
 * Delete a comment on a task (only the author can delete).
 * Root delete cascades to its replies; reactions and notifications for all
 * deleted comments are removed; reply delete recomputes root aggregates.
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

    const isReply = !!comment.parentCommentId;
    let deletedReplyIds = [];

    if (!isReply) {
      // Root: collect and delete its replies too
      const replies = await findManyTaskComments({ parentCommentId: commentId }).select("_id").lean();
      deletedReplyIds = replies.map((r) => r._id);
      if (deletedReplyIds.length > 0) {
        await deleteManyTaskComments({ parentCommentId: commentId });
      }
    }

    await removeTaskComment({ _id: commentId });

    const deletedIds = [comment._id, ...deletedReplyIds];

    // Cascade: reactions + notifications for every deleted comment (non-fatal)
    try {
      await Promise.all([
        removeAllReactionsForComments(deletedIds),
        deleteManyNotifications({ commentId: { $in: deletedIds } }),
      ]);
    } catch (cascadeError) {
      console.error("Error cascading comment delete:", cascadeError);
    }

    // Reply delete: recompute root aggregates (self-healing count + participants)
    let updatedRoot = null;
    if (isReply) {
      updatedRoot = await recomputeThreadAggregates(comment.parentCommentId);
    }

    try {
      emitTaskEvent({
        taskId,
        channelId: task?.channelId || task?.projectId,
        type: "TASK_COMMENT_DELETED",
        payload: {
          commentId,
          taskId,
          deletedBy: userId,
          parentCommentId: comment.parentCommentId || null,
          deletedReplyIds,
          rootComment: updatedRoot
            ? {
                _id: updatedRoot._id,
                replyCount: updatedRoot.replyCount,
                threadParticipants: updatedRoot.threadParticipants,
              }
            : null,
        },
      });
    } catch (socketError) {
      console.error("Error emitting comment delete socket event:", socketError);
    }

    return generateResponse({ commentId, deletedReplyIds }, "Comment deleted successfully", res);
  } catch (error) {
    console.error("Error in deleteTaskComment:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Attach grouped reactions + the current user's reactions to a page of comments.
 * One batched query for the whole page (no N+1).
 */
async function attachReactionsToComments(comments, currentUserId) {
  if (!comments || comments.length === 0) return comments;
  const reactionsMap = await getReactionsGroupedByComments(comments.map((c) => c._id));
  return comments.map((c) => {
    const reactions = reactionsMap[c._id.toString()] || [];
    const userReactions = currentUserId
      ? reactions
          .filter((r) => r.users.some((u) => u._id.toString() === currentUserId.toString()))
          .map((r) => r.emoji)
      : [];
    return { ...c, reactions, userReactions };
  });
}

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
          parentCommentId: null,
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
          parentCommentId: 1,
          replyCount: { $ifNull: ["$replyCount", 0] },
          threadParticipants: { $ifNull: ["$threadParticipants", []] },
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

    const enriched = await attachReactionsToComments(comments, userId);

    return generateResponse({ comments: enriched, pagination }, "Comments retrieved successfully", res);
  } catch (error) {
    console.error("Error in getTaskComments:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Get replies for a specific comment (oldest first).
 * Supports unauthenticated access for shared task links, same as getTaskComments.
 */
exports.getCommentReplies = async (req, res, next) => {
  try {
    const { taskId, commentId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;

    const task = await findTask({ _id: taskId });
    if (!task) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task not found" });

    const rootComment = await findTaskComment({ _id: commentId, taskId, isActive: true });
    if (!rootComment) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Comment not found" });

    // Enforce membership check only for authenticated users
    if (userId) {
      const ctx = await resolveTaskContext(task, userId, next);
      if (!ctx) return;
    }

    const query = [
      {
        $match: {
          parentCommentId: require("mongoose").Types.ObjectId.createFromHexString(commentId),
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
          parentCommentId: 1,
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
    ];

    const { replies, pagination } = await getAllTaskComments({
      query,
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: 1 }, // thread reads top-down
      responseKey: "replies",
    });

    const enriched = await attachReactionsToComments(replies, userId);

    return generateResponse({ replies: enriched, pagination }, "Replies retrieved successfully", res);
  } catch (error) {
    console.error("Error in getCommentReplies:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Toggle an emoji reaction on a comment (add if absent, remove if present).
 * Notification goes to the comment author only, on "added", never for self-reactions.
 */
exports.toggleCommentReaction = async (req, res, next) => {
  try {
    const { taskId, commentId } = req.params;
    const { emoji } = parseBody(req.body);
    const userId = req.user.id;

    const task = await findTask({ _id: taskId });
    if (!task) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Task not found" });

    const comment = await findTaskComment({ _id: commentId, taskId, isActive: true });
    if (!comment) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Comment not found" });

    const user = await findUser({ _id: userId });
    if (!user) return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });

    const ctx = await resolveTaskContext(task, userId, next);
    if (!ctx) return;

    const { action } = await toggleReaction({ commentId, userId, emoji });
    const reactions = await getReactionsByComment(commentId);

    // Broadcast fresh counts to everyone viewing the task (no excludes —
    // the reactor's other tabs stay in sync, matching chat)
    try {
      // Channel room intentionally skipped so reaction toggles don't fire the generic channel toast
      emitTaskEvent({
        taskId: task._id,
        type: "TASK_COMMENT_REACTION_UPDATED",
        payload: {
          taskId: task._id,
          commentId: comment._id,
          parentCommentId: comment.parentCommentId || null,
          reactions,
          action,
          userId,
          emoji,
        },
      });
    } catch (socketError) {
      console.error("Error emitting reaction socket event:", socketError);
    }

    // Notify the comment author (skip self-reactions and removals)
    if (action === "added" && comment.userId.toString() !== userId) {
      try {
        const authorName = user.name || user.email;
        const io = getIO();
        const notification = await createNotification({
          userId: comment.userId,
          type: "TASK_COMMENT_REACTION",
          activityCategory: "reaction",
          title: "New reaction",
          message: `${authorName} reacted ${emoji} to your comment`,
          taskId: task._id,
          commentId: comment._id,
          channelId: task.channelId || null,
          tabId: task.tabId || null,
          projectId: task.projectId || null,
          reactionEmoji: emoji,
          createdBy: userId,
          contextPath: ctx.contextPath || null,
          aggregationKey: `task-reaction:${commentId}:${emoji}`,
        });

        if (io) {
          io.to(`user:${comment.userId}`).emit("activity:new", {
            _id: notification._id,
            type: "TASK_COMMENT_REACTION",
            activityCategory: "reaction",
            title: "New reaction",
            messagePreview: `${authorName} reacted ${emoji} to your comment`,
            actor: {
              _id: user._id,
              name: user.name,
              email: user.email,
              image: user.image,
            },
            reactionEmoji: emoji,
            taskId: task._id,
            commentId: comment._id,
            channelId: task.channelId || null,
            timestamp: notification.timestamp,
            isRead: false,
            navigationContext: {
              taskId: task._id,
              commentId: comment._id,
              channelId: task.channelId || null,
            },
          });
        }

        if (!(await isUserMuted(comment.userId.toString(), task.channelId || null))) {
          if (io) {
            io.to(`user:${comment.userId}`).emit("tab-activity", {
              type: "TASK_COMMENT_REACTION",
              notification: {
                title: "New reaction",
                message: `${authorName} reacted ${emoji} to your comment on "${task.title}"`,
                icon: emoji,
                color: "info",
              },
              _id: notification._id,
              activityCategory: "reaction",
              actor: {
                _id: user._id,
                name: user.name,
                email: user.email,
                image: user.image,
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
          sendPushIfNotMuted(comment.userId, {
            title: `${emoji} ${authorName} reacted to your comment`,
            body: (comment.contentText || "").substring(0, 80) || "Tap to view the comment",
            icon: "/main-logo.svg",
            url: `/dashboard?task=${task._id}`,
            data: { taskId: task._id.toString(), commentId: comment._id.toString(), channelId: task.channelId ? task.channelId.toString() : null, type: "TASK_COMMENT_REACTION" },
          }, task.channelId || null).catch(() => {});
        }
      } catch (notificationError) {
        console.error("Error creating reaction notification:", notificationError);
        // Non-fatal — the reaction itself succeeded
      }
    }

    return generateResponse(
      { commentId, action, emoji, reactions },
      action === "added" ? "Reaction added" : "Reaction removed",
      res
    );
  } catch (error) {
    console.error("Error in toggleCommentReaction:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};
