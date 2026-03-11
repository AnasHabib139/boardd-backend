"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findTask } = require("../models/taskModel");
const {
  createTaskConnection,
  findTaskConnection,
  deleteTaskConnection,
  aggregateTaskConnections,
} = require("../models/taskConnectionModel");
const { createActivity } = require("../models/activityModel");
const { aggregateTasks } = require("../models/taskModel");
const {
  getTaskConnectionsQuery,
  getSearchableTasksQuery,
} = require("./queries/taskConnectionQueries");

/**
 * Create a bidirectional connection between two tasks
 */
exports.createConnection = async (req, res, next) => {
  try {
    const { sourceTaskId, targetTaskId } = parseBody(req.body);
    const userId = req.user.id;

    // Reject self-connection
    if (sourceTaskId === targetTaskId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "A task cannot be connected to itself",
      });
    }

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Verify both tasks exist and are active
    const [sourceTask, targetTask] = await Promise.all([
      findTask({ _id: sourceTaskId, isActive: true }),
      findTask({ _id: targetTaskId, isActive: true }),
    ]);

    if (!sourceTask) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Source task not found",
      });
    }

    if (!targetTask) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Target task not found",
      });
    }

    // Verify same company
    if (
      sourceTask.companyId.toString() !== targetTask.companyId.toString()
    ) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Cannot connect tasks from different companies",
      });
    }

    // Check for duplicate connection (either direction)
    const existingConnection = await findTaskConnection({
      $or: [
        { sourceTaskId, targetTaskId },
        { sourceTaskId: targetTaskId, targetTaskId: sourceTaskId },
      ],
    });

    if (existingConnection) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "These tasks are already connected",
      });
    }

    // Create the connection
    const connection = await createTaskConnection({
      sourceTaskId,
      targetTaskId,
      companyId: sourceTask.companyId,
      createdBy: userId,
    });

    // Log activity on both tasks
    const activityPromises = [];

    // Activity for source task
    const sourceContext = sourceTask.projectId
      ? { projectId: sourceTask.projectId }
      : { channelId: sourceTask.channelId };

    activityPromises.push(
      createActivity({
        ...sourceContext,
        taskId: sourceTaskId,
        userId,
        actionType: ACTION_TYPE.LINK_TASK,
        field: "connections",
        newValue: targetTask.title,
        message: {
          forCreator: `linked this task to "${targetTask.title}"`,
          forOthers: `linked this task to "${targetTask.title}"`,
        },
      })
    );

    // Activity for target task
    const targetContext = targetTask.projectId
      ? { projectId: targetTask.projectId }
      : { channelId: targetTask.channelId };

    activityPromises.push(
      createActivity({
        ...targetContext,
        taskId: targetTaskId,
        userId,
        actionType: ACTION_TYPE.LINK_TASK,
        field: "connections",
        newValue: sourceTask.title,
        message: {
          forCreator: `linked this task to "${sourceTask.title}"`,
          forOthers: `linked this task to "${sourceTask.title}"`,
        },
      })
    );

    await Promise.all(activityPromises);

    return generateResponse(
      { connection },
      "Tasks connected successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createConnection:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get all connections for a task
 */
exports.getConnections = async (req, res, next) => {
  try {
    const { taskId } = req.params;

    // Verify task exists
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    const pipeline = getTaskConnectionsQuery(taskId);
    const connections = await aggregateTaskConnections(pipeline);

    return generateResponse(
      { connections },
      "Task connections fetched successfully",
      res
    );
  } catch (error) {
    console.error("Error in getConnections:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete a task connection
 */
exports.deleteConnection = async (req, res, next) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;

    // Find the connection
    const connection = await findTaskConnection({ _id: connectionId });
    if (!connection) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Connection not found",
      });
    }

    // Get both tasks (may be deleted already)
    const [sourceTask, targetTask] = await Promise.all([
      findTask({ _id: connection.sourceTaskId }),
      findTask({ _id: connection.targetTaskId }),
    ]);

    // Hard delete the connection
    await deleteTaskConnection({ _id: connectionId });

    // Log activity on both tasks (only if task still exists)
    const activityPromises = [];

    if (sourceTask) {
      const sourceContext = sourceTask.projectId
        ? { projectId: sourceTask.projectId }
        : { channelId: sourceTask.channelId };

      activityPromises.push(
        createActivity({
          ...sourceContext,
          taskId: connection.sourceTaskId,
          userId,
          actionType: ACTION_TYPE.UNLINK_TASK,
          field: "connections",
          previousValue: targetTask?.title || "deleted task",
          message: {
            forCreator: `unlinked this task from "${targetTask?.title || "deleted task"}"`,
            forOthers: `unlinked this task from "${targetTask?.title || "deleted task"}"`,
          },
        })
      );
    }

    if (targetTask) {
      const targetContext = targetTask.projectId
        ? { projectId: targetTask.projectId }
        : { channelId: targetTask.channelId };

      activityPromises.push(
        createActivity({
          ...targetContext,
          taskId: connection.targetTaskId,
          userId,
          actionType: ACTION_TYPE.UNLINK_TASK,
          field: "connections",
          previousValue: sourceTask?.title || "deleted task",
          message: {
            forCreator: `unlinked this task from "${sourceTask?.title || "deleted task"}"`,
            forOthers: `unlinked this task from "${sourceTask?.title || "deleted task"}"`,
          },
        })
      );
    }

    if (activityPromises.length > 0) {
      await Promise.all(activityPromises);
    }

    return generateResponse(
      null,
      "Connection removed successfully",
      res
    );
  } catch (error) {
    console.error("Error in deleteConnection:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Search tasks by name within a channel (for connection dropdown)
 */
exports.searchTasksForConnection = async (req, res, next) => {
  try {
    const { channelId, search, excludeTaskId, limit } = req.query;

    const pipeline = getSearchableTasksQuery(
      channelId,
      search,
      excludeTaskId,
      limit
    );
    const tasks = await aggregateTasks(pipeline);

    return generateResponse({ tasks }, "Tasks fetched successfully", res);
  } catch (error) {
    console.error("Error in searchTasksForConnection:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
