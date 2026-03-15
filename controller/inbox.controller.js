"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { getAllTasks, findTask } = require("../models/taskModel");
const { bulkCreateTaskInboxEntries, findTaskInboxEntry, upsertTaskInboxEntry, findUserTaskInboxEntries } = require("../models/taskInboxModel");
const {
  getUserInboxTasksQuery,
  getImportantInboxUnreadCountQuery,
  getOutboxInboxUnreadCountQuery,
} = require("./queries/inboxQueries");
const { getIO } = require("../utils/socket");
const { emitInboxUnreadUpdate } = require("../utils/inboxNotifications");

/**
 * Get user's inbox tasks (important/outbox/cleared filters)
 */
exports.getUserInbox = async (req, res, next) => {
  try {
    const { filter = 'important', limit, page } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate filter
    const allowedFilters = ['important', 'outbox', 'cleared'];
    if (!allowedFilters.includes(filter)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Invalid filter. Allowed values: ${allowedFilters.join(', ')}`,
      });
    }

    // All filters are now implemented
    // No filter restriction needed

    let result;

    if (filter === 'cleared') {
      // For cleared filter, query from taskinboxes collection
      const query = getUserInboxTasksQuery(userId, filter);
      result = await findUserTaskInboxEntries({
        query,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        responseKey: "inboxTasks"
      });
    } else {
      // For important and outbox filters, query from tasks collection
      const query = getUserInboxTasksQuery(userId, filter);
      result = await getAllTasks({
        query,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        responseKey: "inboxTasks",
        sort: { inboxCreatedAt: -1, createdAt: -1 },
      });
    }

    // Handle on-demand inbox entry creation
    const tasksNeedingInboxEntries = result.inboxTasks.filter(task => task.needsInboxEntry);
    
    if (tasksNeedingInboxEntries.length > 0) {
      try {
        // Bulk create inbox entries for tasks that need them
        const entriesToCreate = tasksNeedingInboxEntries.map(task => ({
          userId: userId,
          taskId: task._id.toString()
        }));

        await bulkCreateTaskInboxEntries(entriesToCreate);
        
        // Update the response to show these entries are now created
        result.inboxTasks.forEach(task => {
          if (task.needsInboxEntry) {
            task.needsInboxEntry = false;
            task.isRead = false;
            task.isCleared = false;
            task.inboxCreatedAt = new Date();
          }
        });
      } catch (bulkCreateError) {
        console.error("Error creating inbox entries:", bulkCreateError);
        // Continue with the response even if bulk creation fails
      }
    }

    // Remove the needsInboxEntry field from response
    result.inboxTasks.forEach(task => {
      delete task.needsInboxEntry;
    });

    // Prepare response metadata
    const responseData = {
      ...result,
      filter,
      totalCreated: tasksNeedingInboxEntries.length,
    };

    return generateResponse(
      responseData,
      `${filter.charAt(0).toUpperCase() + filter.slice(1)} inbox tasks fetched successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUserInbox:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get inbox unread counts (important + outbox)
 */
exports.getInboxUnreadCount = async (req, res, next) => {
  try {
    const userId = req?.user?.id;

    const { model } = require("mongoose");
    const TaskModel = model("Task");

    const [importantResult, outboxResult] = await Promise.all([
      TaskModel.aggregate(getImportantInboxUnreadCountQuery(userId)),
      TaskModel.aggregate(getOutboxInboxUnreadCountQuery(userId)),
    ]);

    const important = importantResult[0]?.count || 0;
    const outbox = outboxResult[0]?.count || 0;

    return generateResponse(
      { important, outbox, total: important + outbox },
      "Inbox unread counts fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getInboxUnreadCount:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Toggle read status of inbox entry
 */
exports.toggleReadStatus = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find existing inbox entry
    const existingEntry = await findTaskInboxEntry({
      userId: userId,
      taskId: taskId
    });

    let newReadStatus;
    if (existingEntry) {
      // Toggle existing status
      newReadStatus = !existingEntry.isRead;
    } else {
      // Create new entry with read = true
      newReadStatus = true;
    }

    // Upsert with toggled status
    const updatedEntry = await upsertTaskInboxEntry(userId, taskId, {
      isRead: newReadStatus
    });

    // Emit updated inbox unread counts via socket
    try {
      const io = getIO();
      await emitInboxUnreadUpdate(userId, io);
    } catch (socketError) {
      console.error("Socket error in toggleReadStatus:", socketError);
    }

    return generateResponse(
      {
        taskId,
        isRead: updatedEntry.isRead,
        isCleared: updatedEntry.isCleared,
        updatedAt: updatedEntry.updatedAt
      },
      `Task marked as ${newReadStatus ? 'read' : 'unread'}`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in toggleReadStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Toggle cleared status of inbox entry
 */
exports.toggleClearedStatus = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find existing inbox entry
    const existingEntry = await findTaskInboxEntry({
      userId: userId,
      taskId: taskId
    });

    let newClearedStatus;
    if (existingEntry) {
      // Toggle existing status
      newClearedStatus = !existingEntry.isCleared;
    } else {
      // Create new entry with cleared = true
      newClearedStatus = true;
    }

    // Upsert with toggled status
    const updatedEntry = await upsertTaskInboxEntry(userId, taskId, {
      isCleared: newClearedStatus
    });

    // Emit updated inbox unread counts via socket
    try {
      const io = getIO();
      await emitInboxUnreadUpdate(userId, io);
    } catch (socketError) {
      console.error("Socket error in toggleClearedStatus:", socketError);
    }

    // Determine if task is from inbox or outbox
    const task = await findTask({ _id: taskId });
    const source = task && task.createdBy?.toString() === userId.toString() ? "outbox" : "inbox";

    return generateResponse(
      {
        taskId,
        isRead: updatedEntry.isRead,
        isCleared: updatedEntry.isCleared,
        updatedAt: updatedEntry.updatedAt
      },
      `Task ${newClearedStatus ? 'cleared from' : 'restored to'} ${source}`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in toggleClearedStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};