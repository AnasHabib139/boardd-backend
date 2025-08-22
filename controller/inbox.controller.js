"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { getAllTasks } = require("../models/taskModel");
const { bulkCreateTaskInboxEntries } = require("../models/taskInboxModel");
const { getUserInboxTasksQuery } = require("./queries/inboxQueries");

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

    // For now, only implement 'important' and 'outbox' filters
    if (filter !== 'important' && filter !== 'outbox') {
      return next({
        statusCode: STATUS_CODES.NOT_IMPLEMENTED,
        message: `Filter '${filter}' is not yet implemented`,
      });
    }

    // Get inbox tasks query
    const query = getUserInboxTasksQuery(userId, filter);

    // Execute query with pagination
    const result = await getAllTasks({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "inboxTasks",
      sort: { inboxCreatedAt: -1, createdAt: -1 },
    });

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