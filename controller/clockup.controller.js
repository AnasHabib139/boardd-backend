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
} = require("../models/timeEntryModel");
const {
  handleStartTimeChange,
  handleEndTimeChange,
  handleTotalTimeChange,
  calculateDurationMinutes,
  formatDuration,
} = require("./helpers/timeHelper");
const { getUserTimeEntriesQuery } = require("./queries/timeEntriesQueries");

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
