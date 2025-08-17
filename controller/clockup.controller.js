"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const {
  createTimeEntry,
  findActiveTimeEntry,
  updateTimeEntry,
  findTimeEntry,
  getAllTimeEntries,
  updateParentEntryAggregates,
  hasChildren,
} = require("../models/timeEntryModel");
const {
  handleStartTimeChange,
  handleEndTimeChange,
  handleTotalTimeChange,
  calculateDurationMinutes,
  formatDuration,
} = require("./helpers/timeHelper");
const { getUserTimeEntriesQuery, getChildrenTimeEntriesQuery } = require("./queries/timeEntriesQueries");

/**
 * Start clock - Begin time tracking
 */
exports.startClock = async (req, res, next) => {
  try {
    const { title, description, startTime } = parseBody(req.body);
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user already has an active time entry
    const activeEntry = await findActiveTimeEntry(userId);
    if (activeEntry) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "You already have an active time entry. Please stop the current timer before starting a new one.",
        data: {
          activeEntry: {
            _id: activeEntry._id,
            title: activeEntry.title,
            description: activeEntry.description,
            startTime: activeEntry.startTime,
          },
        },
      });
    }

    // Create new time entry
    const timeEntry = await createTimeEntry({
      userId,
      title: title || "",
      description: description || "",
      startTime: new Date(startTime), // Convert user's local time to Date object
      createdAt: new Date(startTime),
    });

    return generateResponse(
      {
        timeEntry: {
          _id: timeEntry._id,
          title: timeEntry.title,
          description: timeEntry.description,
          startTime: timeEntry.startTime,
          totalTime: timeEntry.totalTime,
          isActive: timeEntry.isActive,
          createdAt: timeEntry.createdAt,
        },
      },
      "Clock started successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in startClock:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Stop clock - End time tracking and calculate total time
 */
exports.stopClock = async (req, res, next) => {
  try {
    const { endTime } = parseBody(req.body);
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find active time entry
    const activeEntry = await findActiveTimeEntry(userId);
    if (!activeEntry) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "No active time entry found. Please start a timer first.",
      });
    }

    // Update time entry with end time
    const updatedEntry = await updateTimeEntry(
      { _id: activeEntry._id },
      {
        endTime: new Date(endTime), // Convert user's local time to Date object
        // totalTime will be calculated automatically by pre-save middleware
      }
    );

    // If this is a child entry, update parent aggregates
    if (updatedEntry.parentEntryId) {
      await updateParentEntryAggregates(updatedEntry.parentEntryId);
    }

    return generateResponse(
      {
        timeEntry: {
          _id: updatedEntry._id,
          title: updatedEntry.title,
          description: updatedEntry.description,
          startTime: updatedEntry.startTime,
          endTime: updatedEntry.endTime,
          totalTime: updatedEntry.totalTime, // In minutes
          isActive: updatedEntry.isActive,
        },
      },
      "Clock stopped successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in stopClock:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Edit time entry - Update title, description, startTime, endTime, or totalTime
 */
exports.editTimeEntry = async (req, res, next) => {
  try {
    const { entryId } = req.params;
    const { title, description, startTime, endTime, totalTime } = parseBody(
      req.body
    );
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find the time entry
    const timeEntry = await findTimeEntry({ _id: entryId, userId });
    if (!timeEntry) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Time entry not found or you don't have permission to edit it",
      });
    }

    // Validate: Parent with children cannot edit time fields
    if (!timeEntry.parentEntryId && (startTime || endTime || totalTime)) {
      const parentHasChildren = await hasChildren(timeEntry._id);
      if (parentHasChildren) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Parent entries with child sessions cannot edit time fields. Only title and description can be modified.",
        });
      }
    }

    // Validate: Child startTime cannot be before parent startTime
    if (timeEntry.parentEntryId && startTime) {
      const parentEntry = await findTimeEntry({ _id: timeEntry.parentEntryId });
      if (parentEntry && new Date(startTime) < parentEntry.startTime) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Child entry cannot start before parent entry start time.",
        });
      }
    }

    // Prepare update data
    let updateData = {};
    let newStartTime = timeEntry.startTime;
    let newEndTime = timeEntry.endTime;
    let daysAdded = 0;

    // Update title and description if provided
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;

    // Handle different types of time changes
    if (startTime && endTime && totalTime) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Cannot update startTime, endTime, and totalTime simultaneously. Please update one at a time.",
      });
    }

    if (startTime && endTime) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Cannot update both startTime and endTime simultaneously. Please update one at a time.",
      });
    }

    if (startTime && totalTime) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Cannot update both startTime and totalTime simultaneously. Please update one at a time.",
      });
    }

    if (endTime && totalTime) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Cannot update both endTime and totalTime simultaneously. Please update one at a time.",
      });
    }

    // Handle start time change
    if (startTime) {
      const currentDaysAdded = timeEntry.daysAdded || 0;
      const result = handleStartTimeChange(
        timeEntry.startTime,
        timeEntry.endTime,
        startTime,
        currentDaysAdded
      );
      newStartTime = result.newStartTime;
      newEndTime = result.newEndTime;
      daysAdded = result.daysAdded;

      updateData.startTime = newStartTime;
      updateData.endTime = newEndTime;
      updateData.daysAdded = daysAdded;
    }
    // Handle end time change
    else if (endTime) {
      const currentDaysAdded = timeEntry.daysAdded || 0;
      const result = handleEndTimeChange(
        timeEntry.startTime,
        timeEntry.endTime,
        endTime,
        currentDaysAdded
      );
      newEndTime = result.newEndTime;
      daysAdded = result.daysAdded;

      updateData.endTime = newEndTime;
      updateData.daysAdded = daysAdded;
    }
    // Handle total time change
    else if (totalTime) {
      const result = handleTotalTimeChange(timeEntry.startTime, totalTime);
      newEndTime = result.newEndTime;
      daysAdded = result.daysAdded;

      updateData.endTime = newEndTime;
      updateData.daysAdded = daysAdded;
    }

    // Calculate final total time in minutes
    if (newStartTime && newEndTime) {
      updateData.totalTime = calculateDurationMinutes(newStartTime, newEndTime);
    }

    // Update the time entry
    const updatedEntry = await updateTimeEntry({ _id: entryId }, updateData);

    // If this is a child entry, update parent aggregates
    if (updatedEntry.parentEntryId) {
      await updateParentEntryAggregates(updatedEntry.parentEntryId);
    }

    return generateResponse(
      {
        timeEntry: {
          _id: updatedEntry._id,
          title: updatedEntry.title,
          description: updatedEntry.description,
          startTime: updatedEntry.startTime,
          endTime: updatedEntry.endTime,
          totalTime: updatedEntry.totalTime, // In minutes
          totalTimeFormatted: formatDuration(updatedEntry.totalTime), // HH:MM:SS format
          daysAdded: updatedEntry.daysAdded, // Stored in DB for persistence
          isActive: updatedEntry.isActive,
        },
      },
      "Time entry updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in editTimeEntry:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Restart time entry - Create child entry linked to parent
 */
exports.restartTimeEntry = async (req, res, next) => {
  try {
    const { entryId } = req.params;
    const { startTime } = parseBody(req.body);
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user already has an active time entry
    const activeEntry = await findActiveTimeEntry(userId);
    if (activeEntry) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "You already have an active time entry. Please stop the current timer before restarting another one.",
        data: {
          activeEntry: {
            _id: activeEntry._id,
            title: activeEntry.title,
            description: activeEntry.description,
            startTime: activeEntry.startTime,
          }
        }
      });
    }

    // Find the time entry to restart
    const timeEntry = await findTimeEntry({ _id: entryId, userId });
    if (!timeEntry) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Time entry not found or you don't have permission to restart it",
      });
    }

    // Validate that this is a parent entry (cannot restart child entries)
    if (timeEntry.parentEntryId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Cannot restart a child entry. Please restart the parent entry instead.",
      });
    }

    // Check if the entry is already active (not stopped)
    if (timeEntry.isActive && !timeEntry.endTime) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "This time entry is already active. Please stop it first.",
      });
    }

    // Validate child startTime cannot be before parent startTime
    if (new Date(startTime) < timeEntry.startTime) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Child entry cannot start before parent entry start time.",
      });
    }

    // Create child time entry linked to parent
    const childTimeEntry = await createTimeEntry({
      userId,
      title: timeEntry.title,
      description: timeEntry.description,
      startTime: new Date(startTime),
      createdAt: new Date(startTime),
      parentEntryId: timeEntry._id, // Link to parent
    });

    return generateResponse(
      {
        timeEntry: {
          _id: childTimeEntry._id,
          title: childTimeEntry.title,
          description: childTimeEntry.description,
          startTime: childTimeEntry.startTime,
          totalTime: childTimeEntry.totalTime,
          isActive: childTimeEntry.isActive,
          createdAt: childTimeEntry.createdAt,
          parentEntryId: childTimeEntry.parentEntryId,
        },
        parentEntry: {
          _id: timeEntry._id,
          title: timeEntry.title,
          description: timeEntry.description,
        }
      },
      "Time entry restarted successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in restartTimeEntry:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get user time entries - Retrieve paginated time entries for logged-in user
 */
exports.getUserTimeEntries = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get the aggregation query for user time entries
    const query = getUserTimeEntriesQuery(userId);

    // Get paginated time entries
    const result = await getAllTimeEntries({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "timeEntries",
    });

    return generateResponse(
      result,
      "Time entries retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUserTimeEntries:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get children time entries - Retrieve paginated child entries for a parent time entry
 */
exports.getChildrenTimeEntries = async (req, res, next) => {
  try {
    const { entryId } = req.params;
    const { page, limit } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate parent entry exists and belongs to user
    const parentEntry = await findTimeEntry({ _id: entryId, userId });
    if (!parentEntry) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Parent time entry not found or you don't have permission to view it",
      });
    }

    // Validate this is a parent entry (not a child)
    if (parentEntry.parentEntryId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Cannot get children of a child entry. Please use the parent entry ID.",
      });
    }

    // Get the aggregation query for children time entries
    const query = getChildrenTimeEntriesQuery(entryId);

    // Get paginated children time entries
    const result = await getAllTimeEntries({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "childrenEntries"
    });

    return generateResponse(
      {
        ...result,
        parentEntry: {
          _id: parentEntry._id,
          title: parentEntry.title,
          description: parentEntry.description,
          startTime: parentEntry.startTime,
          endTime: parentEntry.endTime,
          totalTime: parentEntry.totalTime,
        }
      },
      "Children time entries retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getChildrenTimeEntries:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
