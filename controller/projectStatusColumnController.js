"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findManyProjects } = require("../models/projectModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findManyTasks, updateTask } = require("../models/taskModel");
const {
  createProjectStatusColumn,
  findProjectStatusColumn,
  getNextOrderIndex,
  deleteProjectStatusColumn,
  updateProjectStatusColumn,
} = require("../models/projectStatusColumnModel");

/**
 * Create a new column for tab and apply default values to existing tasks
 */
exports.createProjectStatusColumn = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const { columnName, columnType, dropdownOptions, isRequired } = parseBody(req.body);
    const userId = req.user.id;

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate tab exists and user has access
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    // Check if user is tab member
    const isTabMember = tab.members.some(memberId => memberId.toString() === userId.toString());
    if (!isTabMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Generate unique column key from column name
    const columnKey = columnName.toLowerCase().replace(/[^a-z0-9]/g, "_");

    // Check if column key already exists for this tab
    const existingColumn = await findProjectStatusColumn({
      tabId,
      columnKey,
    });

    if (existingColumn) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "Column with this name already exists in this tab",
      });
    }

    // Get next order index for this tab
    const order = await getNextOrderIndex(tabId);

    // Create the column definition
    const columnData = {
      tabId,
      columnKey,
      columnName,
      columnType,
      dropdownOptions: columnType === "dropdown" ? dropdownOptions : undefined,
      isRequired: isRequired || false,
      defaultValue: null, // Always null for empty state
      order,
    };

    const newColumn = await createProjectStatusColumn(columnData);

    // Apply to ALL existing tasks in this tab (both project tasks and open tasks)
    const existingTasks = await findManyTasks({
      tabId,
      isActive: true,
    });

    // Get projects count for response (optional)
    const projects = await findManyProjects({ tabId });

    if (existingTasks.length > 0) {
      console.log(`📝 Applying column to ${existingTasks.length} tasks in tab`);

      // Update all tasks in batches
      const batchSize = 100;
      let updatedCount = 0;

      for (let i = 0; i < existingTasks.length; i += batchSize) {
        const batch = existingTasks.slice(i, i + batchSize);

        // Use Promise.all for parallel updates within batch
        const updatePromises = batch.map(task => {
          // Set the new column value to null (empty state)
          const updateData = {
            [`statusColumnValues.${columnKey}`]: null,
            updatedAt: new Date(),
          };

          return updateTask({ _id: task._id }, { $set: updateData });
        });

        await Promise.all(updatePromises);
        updatedCount += batch.length;

        console.log(`✅ Updated batch ${Math.floor(i / batchSize) + 1}: ${batch.length} tasks`);
      }

      console.log(`🎉 Applied column to ${updatedCount} tasks in tab (${projects.length} projects + open tasks)`);
    }

    return generateResponse(
      {
        column: newColumn,
        tasksUpdated: existingTasks.length,
        projectsAffected: projects.length,
      },
      `Column "${columnName}" created for tab. Applied to ${existingTasks.length} tasks.`,
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createProjectStatusColumn:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete a column and remove it from all tasks in the tab
 */
exports.deleteProjectStatusColumn = async (req, res, next) => {
  try {
    const { tabId, columnId } = req.params;
    const userId = req.user.id;

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate tab exists and user has access
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    // Check if user is tab member
    const isTabMember = tab.members.some(memberId => memberId.toString() === userId.toString());
    if (!isTabMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Find the column
    const column = await findProjectStatusColumn({ _id: columnId, tabId });
    if (!column) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Column not found in this tab",
      });
    }

    // Find all tasks in this tab
    const existingTasks = await findManyTasks({
      tabId,
      isActive: true,
    });

    // Remove column key from all tasks in batches
    if (existingTasks.length > 0) {
      console.log(`🗑️  Removing column "${column.columnName}" from ${existingTasks.length} tasks`);

      const batchSize = 100;
      let updatedCount = 0;

      for (let i = 0; i < existingTasks.length; i += batchSize) {
        const batch = existingTasks.slice(i, i + batchSize);

        // Use Promise.all for parallel updates within batch
        const updatePromises = batch.map(task => {
          // Remove the column key from statusColumnValues
          const updateData = {
            $unset: { [`statusColumnValues.${column.columnKey}`]: "" },
            updatedAt: new Date(),
          };

          return updateTask({ _id: task._id }, updateData);
        });

        await Promise.all(updatePromises);
        updatedCount += batch.length;

        console.log(`✅ Removed from batch ${Math.floor(i / batchSize) + 1}: ${batch.length} tasks`);
      }

      console.log(`🎉 Removed column from ${updatedCount} tasks`);
    }

    // Delete the column definition
    await deleteProjectStatusColumn({ _id: columnId });

    return generateResponse(
      {
        tasksAffected: existingTasks.length,
        columnName: column.columnName,
      },
      `Column "${column.columnName}" deleted and removed from ${existingTasks.length} tasks`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteProjectStatusColumn:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Update a column (currently supports name changes)
 */
exports.updateProjectStatusColumn = async (req, res, next) => {
  try {
    const { tabId, columnId } = req.params;
    const { columnName } = parseBody(req.body);
    const userId = req.user.id;

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate tab exists and user has access
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    // Check if user is tab member
    const isTabMember = tab.members.some(memberId => memberId.toString() === userId.toString());
    if (!isTabMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Find the column
    const column = await findProjectStatusColumn({ _id: columnId, tabId });
    if (!column) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Column not found in this tab",
      });
    }

    // Update the column
    const updatedColumn = await updateProjectStatusColumn(
      { _id: columnId },
      { columnName, updatedAt: new Date() },
      { new: true }
    );

    return generateResponse(
      { column: updatedColumn },
      "Column updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateProjectStatusColumn:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

