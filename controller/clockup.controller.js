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
  deleteTimeEntryWithChildren,
} = require("../models/timeEntryModel");
const {
  handleStartTimeChange,
  handleEndTimeChange,
  handleTotalTimeChange,
  calculateDurationMinutes,
  formatDuration,
  getWeekRange,
} = require("./helpers/timeHelper");
const {
  getUserTimeEntriesQuery,
  getChildrenTimeEntriesQuery,
} = require("./queries/timeEntriesQueries");

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

    // Validate startTime is a valid ISO string
    if (!startTime || isNaN(Date.parse(startTime))) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "startTime must be a valid ISO timestamp (e.g., '2024-01-15T05:00:00+05:00')",
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

    // Validate endTime is a valid ISO string
    if (!endTime || isNaN(Date.parse(endTime))) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "endTime must be a valid ISO timestamp (e.g., '2024-01-15T17:30:00+05:00')",
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

    // Validate ISO timestamps if provided
    if (startTime && isNaN(Date.parse(startTime))) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "startTime must be a valid ISO timestamp",
      });
    }

    if (endTime && isNaN(Date.parse(endTime))) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "endTime must be a valid ISO timestamp",
      });
    }

    // Validate: Parent with children cannot edit time fields
    if (!timeEntry.parentEntryId && (startTime || endTime || totalTime)) {
      const parentHasChildren = await hasChildren(timeEntry._id);
      if (parentHasChildren) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message:
            "Parent entries with child sessions cannot edit time fields. Only title and description can be modified.",
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
        message:
          "You already have an active time entry. Please stop the current timer before restarting another one.",
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

    // Find the time entry to restart
    const timeEntry = await findTimeEntry({ _id: entryId, userId });
    if (!timeEntry) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message:
          "Time entry not found or you don't have permission to restart it",
      });
    }

    // Validate that this is a parent entry (cannot restart child entries)
    if (timeEntry.parentEntryId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Cannot restart a child entry. Please restart the parent entry instead.",
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
        },
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
    const { page, limit, filter } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate week filter if provided
    const validFilters = ["this_week", "last_week"];
    if (filter && !validFilters.includes(filter)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid filter. Use 'this_week' or 'last_week'",
      });
    }

    // Get week range for filtering
    const weekRange = filter ? getWeekRange(filter) : null;

    // Get the aggregation query for user time entries
    const query = getUserTimeEntriesQuery(userId, weekRange);

    // Get paginated time entries
    const result = await getAllTimeEntries({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "timeEntries",
    });

    // Add filter context to response
    const responseData = {
      ...result,
      filterApplied: filter || "all",
    };

    if (weekRange) {
      responseData.weekRange = {
        start: weekRange.start.toISOString().split("T")[0],
        end: weekRange.end.toISOString().split("T")[0],
      };
    }

    return generateResponse(
      responseData,
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
        message:
          "Parent time entry not found or you don't have permission to view it",
      });
    }

    // Validate this is a parent entry (not a child)
    if (parentEntry.parentEntryId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Cannot get children of a child entry. Please use the parent entry ID.",
      });
    }

    // Get the aggregation query for children time entries
    const query = getChildrenTimeEntriesQuery(entryId);

    // Get paginated children time entries
    const result = await getAllTimeEntries({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "childrenEntries",
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
        },
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

/**
 * Duplicate time entry - Create a copy of time entry
 * Rules: Parent with children cannot be duplicated, children can be duplicated, parent without children can be duplicated
 */
exports.duplicateTimeEntry = async (req, res, next) => {
  try {
    const { entryId } = req.params;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find the time entry to duplicate
    const timeEntry = await findTimeEntry({ _id: entryId, userId });
    if (!timeEntry) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message:
          "Time entry not found or you don't have permission to duplicate it",
      });
    }

    // No need to check for active entries since duplicate won't be active

    // Business rule validation: Parent with children cannot be duplicated
    if (!timeEntry.parentEntryId) {
      // This is a parent entry, check if it has children
      const parentHasChildren = await hasChildren(timeEntry._id);
      if (parentHasChildren) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message:
            "Parent entries with child sessions cannot be duplicated. You can duplicate individual child sessions instead.",
        });
      }
    }

    // Create duplicate entry (copy all time fields exactly)
    const duplicateData = {
      userId,
      title: timeEntry.title || "",
      description: timeEntry.description || "",
      startTime: timeEntry.startTime, // Copy exact start time
      endTime: timeEntry.endTime, // Copy exact end time
      totalTime: timeEntry.totalTime, // Copy exact total time
      daysAdded: timeEntry.daysAdded || 0, // Copy days added
      isActive: false, // Duplicate is not active
      createdAt: new Date(), // New creation time
      // For child entries, preserve the parent relationship
      parentEntryId: timeEntry.parentEntryId || null,
    };

    const duplicatedEntry = await createTimeEntry(duplicateData);

    // If this is a child entry, update parent aggregates
    if (duplicatedEntry.parentEntryId) {
      await updateParentEntryAggregates(duplicatedEntry.parentEntryId);
    }

    const responseMessage = timeEntry.parentEntryId
      ? "Child time entry duplicated successfully"
      : "Time entry duplicated successfully";

    return generateResponse(
      {
        timeEntry: {
          _id: duplicatedEntry._id,
          title: duplicatedEntry.title,
          description: duplicatedEntry.description,
          startTime: duplicatedEntry.startTime,
          endTime: duplicatedEntry.endTime,
          totalTime: duplicatedEntry.totalTime,
          daysAdded: duplicatedEntry.daysAdded,
          isActive: duplicatedEntry.isActive,
          createdAt: duplicatedEntry.createdAt,
          parentEntryId: duplicatedEntry.parentEntryId,
        },
        originalEntry: {
          _id: timeEntry._id,
          title: timeEntry.title,
          description: timeEntry.description,
          isParent: !timeEntry.parentEntryId,
        },
      },
      responseMessage,
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in duplicateTimeEntry:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete time entry - Delete time entry with all children (if parent) or single entry (if child)
 */
exports.deleteTimeEntry = async (req, res, next) => {
  try {
    const { entryId } = req.params;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find the time entry to delete
    const timeEntry = await findTimeEntry({ _id: entryId, userId });
    if (!timeEntry) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message:
          "Time entry not found or you don't have permission to delete it",
      });
    }

    // Check if entry is currently active
    if (timeEntry.isActive && !timeEntry.endTime) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Cannot delete an active time entry. Please stop the timer first.",
      });
    }

    // Delete the entry (and children if it's a parent)
    const deleteResult = await deleteTimeEntryWithChildren(entryId);

    if (!deleteResult) {
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Failed to delete time entry",
      });
    }

    // If this was a child entry, update parent aggregates
    if (timeEntry.parentEntryId) {
      await updateParentEntryAggregates(timeEntry.parentEntryId);
    }

    const isParent = !timeEntry.parentEntryId;
    const message = isParent
      ? `Time entry and ${
          deleteResult.totalDeleted - 1
        } child entries deleted successfully`
      : "Time entry deleted successfully";

    return generateResponse(
      {
        deletedEntry: {
          _id: deleteResult.deletedEntry._id,
          title: deleteResult.deletedEntry.title,
          description: deleteResult.deletedEntry.description,
          isParent,
          totalDeleted: deleteResult.totalDeleted,
        },
      },
      message,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteTimeEntry:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
