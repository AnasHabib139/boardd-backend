"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findTask, updateTask } = require("../models/taskModel");
const { findProject } = require("../models/projectModel");
const {
  createSubtask,
  findSubtask,
  updateSubtask,
  deleteSubtask,
} = require("../models/subtaskModel");
const { emitTaskEvent, getIO } = require("../utils/socket");
const { createActivity } = require("../models/activityModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const { createNotification } = require("../models/notificationModel");
const { emitUserNotification } = require("../utils/socket");

/**
 * Create a new subtask
 */
exports.createSubtask = async (req, res, next) => {
  try {
    const { title, taskId, assignedTo } = parseBody(req.body);

    // Check if task exists
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    // Check if project exists
    const project = await findProject({ _id: task.projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Get creator's info
    const userId = req.user.id;
    const creator = await findUser({ _id: userId });
    if (!creator) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get tab and channel info for context
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    const channel = await findChannel({ _id: project.channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Create subtask object
    const subtaskData = {
      title,
      taskId,
      projectId: task.projectId,
      createdBy: userId,
      assignedTo: assignedTo || [],
    };

    // Create subtask
    const subtask = await createSubtask(subtaskData);

    // Update task version to prevent conflicts with socket updates
    const updatedTask = await updateTask(
      { _id: taskId },
      {
        $inc: { version: 1 },
        updatedAt: new Date(),
      },
      { new: true }
    );

    const contextPath = `${channel.channelName} / ${tab.tabName}`;
    const userName = creator.name || creator.email;

    // Initialize activities and notifications arrays
    const activities = [];
    const notifications = [];

    // 1. Create activity for subtask creation
    const createSubtaskMessage = {
      forCreator: `You created subtask "${title}" for task "${task.title}"`,
      forOthers: `${userName} created subtask "${title}" for task "${task.title}"`,
    };

    const activity = await createActivity({
      projectId: task.projectId,
      taskId,
      subtaskId: subtask._id,
      userId,
      actionType: ACTION_TYPE.CREATE_SUBTASK,
      timestamp: new Date(),
      message: createSubtaskMessage,
    });
    activities.push(activity);

    // 2. Create notifications for task creator and tab members
    for (const memberId of tab.members) {
      notifications.push(
        createNotification({
          userId: memberId,
          type: "CHANNEL",
          projectId: task.projectId,
          channelId: channel._id,
          tabId: tab._id,
          taskId: task._id,
          createdBy: userId,
          title: "New Subtask Created",
          message:
            memberId.toString() === userId.toString()
              ? createSubtaskMessage.forCreator
              : createSubtaskMessage.forOthers,
          contextPath,
        })
      );
    }

    // 3. Create notifications for assigned users
    if (assignedTo && assignedTo.length > 0) {
      for (const assigneeId of assignedTo) {
        if (assigneeId !== userId) {
          notifications.push(
            createNotification({
              userId: assigneeId,
              type: "MENTION",
              projectId: task.projectId,
              channelId: channel._id,
              tabId: tab._id,
              taskId: task._id,
              createdBy: userId,
              title: "Subtask Assignment",
              message: `${userName} assigned you to subtask "${title}" in task "${task.title}"`,
              contextPath,
            })
          );
        }
      }
    }

    // Save all notifications
    await Promise.all(notifications);

    // Emit socket events
    try {
      // Emit task-update-response to task room (for backward compatibility)
      const io = getIO();

      io.to(`task:${taskId}`).emit("task-update-response", {
        success: true,
        taskId,
        field: "subtasks", // Indicate this is a subtask change
        previousValue: null, // No previous subtask
        newValue: subtask,
        version: updatedTask.version,
        activity: {
          _id: activity._id,
          message: createSubtaskMessage,
          timestamp: activity.timestamp,
          user: {
            _id: creator._id,
            name: creator.name,
            email: creator.email,
          },
        },
      });

      // Emit notifications to assigned users
      if (assignedTo && assignedTo.length > 0) {
        assignedTo.forEach((assigneeId) => {
          if (assigneeId !== userId) {
            emitUserNotification(assigneeId, {
              type: "MENTION",
              message: `${userName} assigned you to subtask "${title}" in task "${task.title}"`,
              taskId: task._id,
              context: {
                channelId: channel._id,
                tabId: tab._id,
                projectId: project._id,
                projectName: project.name,
                contextPath,
              },
            });
          }
        });
      }
    } catch (error) {
      console.error("Socket error:", error);
      // Continue even if socket fails
    }

    return generateResponse(
      subtask,
      "Subtask created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createSubtask:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Update subtask
 */
exports.updateSubtask = async (req, res, next) => {
  try {
    const { subtaskId } = req.params;
    const updates = parseBody(req.body);
    const userId = req.user.id;

    // Find subtask
    const subtask = await findSubtask({ _id: subtaskId });
    if (!subtask) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Subtask not found",
      });
    }

    // Get project for context
    const project = await findProject({ _id: subtask.projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Capture previous values for activity tracking
    const previousValues = {};
    const updateFields = {};

    // Only update allowed fields and track changes
    const allowedFields = ["title", "description", "status", "assignedTo", "isCompleted"];

    for (const field of allowedFields) {
      if (field in updates && updates[field] !== undefined) {
        previousValues[field] = subtask[field];
        updateFields[field] = updates[field];
      }
    }

    // Add updatedAt timestamp
    updateFields.updatedAt = new Date();

    // Update subtask
    const updatedSubtask = await updateSubtask(
      { _id: subtaskId },
      updateFields
    );

    // Update parent task version to prevent conflicts with socket updates
    const updatedTask = await updateTask(
      { _id: subtask.taskId },
      {
        $inc: { version: 1 },
        updatedAt: new Date(),
      },
      { new: true }
    );

    // Get user info for socket emission
    const user = await findUser({ _id: userId });

    // Create one general activity for the entire update
    const userName = user?.name || "Someone";
    const activityMessage = {
      forCreator: `You updated subtask "${updatedSubtask.title}"`,
      forOthers: `${userName} updated subtask "${updatedSubtask.title}"`,
    };

    const activity = await createActivity({
      projectId: subtask.projectId,
      taskId: subtask.taskId,
      subtaskId: subtask._id,
      userId,
      actionType: ACTION_TYPE.UPDATE_SUBTASK,
      timestamp: new Date(),
      message: activityMessage,
    });

    // Emit socket event using standardized approach
    try {
      // Emit task-update-response to task room (for backward compatibility)
      const io = getIO();

      io.to(`task:${subtask.taskId}`).emit("task-update-response", {
        success: true,
        taskId: subtask.taskId,
        field: "subtasks", // Indicate this is a subtask change
        previousValue: previousValues, // Previous subtask state
        newValue: updatedSubtask,
        version: updatedTask.version,
        activity: {
          _id: activity._id,
          message: activity.message,
          timestamp: activity.timestamp,
          user: {
            _id: userId,
            name: user?.name || "Unknown",
            email: user?.email || "unknown@example.com",
          },
        },
      });
    } catch (error) {
      console.error("Socket error:", error);
      // Continue even if socket fails
    }

    return generateResponse(
      updatedSubtask,
      "Subtask updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateSubtask:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete subtask
 */
exports.deleteSubtask = async (req, res, next) => {
  try {
    const { subtaskId } = req.params;
    const userId = req.user.id;

    // Find subtask
    const subtask = await findSubtask({ _id: subtaskId });
    if (!subtask) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Subtask not found",
      });
    }

    // Get project for context
    const project = await findProject({ _id: subtask.projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Get user info for socket emission
    const user = await findUser({ _id: userId });

    // Create activity record
    const userName = user?.name || "Someone";
    const deleteActivityMessage = {
      forCreator: `You deleted subtask "${subtask.title}"`,
      forOthers: `${userName} deleted subtask "${subtask.title}"`,
    };

    const activity = await createActivity({
      projectId: subtask.projectId,
      taskId: subtask.taskId,
      subtaskId: subtask._id,
      userId,
      actionType: ACTION_TYPE.DELETE_SUBTASK,
      timestamp: new Date(),
      message: deleteActivityMessage,
    });

    // Delete subtask
    await deleteSubtask({ _id: subtaskId });

    // Update parent task version to prevent conflicts with socket updates
    const updatedTask = await updateTask(
      { _id: subtask.taskId },
      {
        $inc: { version: 1 },
        updatedAt: new Date(),
      },
      { new: true }
    );

    // Emit socket event using standardized approach
    try {
      // Emit task-update-response to task room (for backward compatibility)
      const io = getIO();

      io.to(`task:${subtask.taskId}`).emit("task-update-response", {
        success: true,
        taskId: subtask.taskId,
        field: "subtasks", // Indicate this is a subtask change
        previousValue: subtask, // The deleted subtask
        newValue: null, // No new value since it's deleted
        version: updatedTask.version,
        activity: {
          _id: activity._id,
          message: activity.message,
          timestamp: activity.timestamp,
          user: {
            _id: userId,
            name: user?.name || "Unknown",
            email: user?.email || "unknown@example.com",
          },
        },
      });
    } catch (error) {
      console.error("Socket error:", error);
      // Continue even if socket fails
    }

    return generateResponse(
      null,
      "Subtask deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteSubtask:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
