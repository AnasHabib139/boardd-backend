"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, TASK_STATUS } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findProject } = require("../models/projectModel");
const { findManyTasks, updateTask } = require("../models/taskModel");
const {
  createProjectStatusColumn,
  findProjectStatusColumn,
  getNextOrderIndex,
} = require("../models/projectStatusColumnModel");

/**
 * Create a new column for specific project status and apply default values to existing tasks
 */
exports.createProjectStatusColumn = async (req, res, next) => {
  try {
    const { projectId, status } = req.params;
    const { columnName, columnType, dropdownOptions, isRequired } = parseBody(req.body);
    const userId = req.user.id;

    // Validate status parameter
    const validStatuses = Object.values(TASK_STATUS);
    if (!validStatuses.includes(status)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
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

    // Validate project exists and user has access
    const project = await findProject({ _id: projectId, companyId: user.companyId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found or access denied",
      });
    }

    // Generate unique column key from column name
    const columnKey = columnName.toLowerCase().replace(/[^a-z0-9]/g, "_");

    // Check if column key already exists for this project+status
    const existingColumn = await findProjectStatusColumn({
      projectId,
      status,
      columnKey,
    });

    if (existingColumn) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "Column with this name already exists for this status",
      });
    }

    // Get next order index for this project+status
    const order = await getNextOrderIndex(projectId, status);

    // Create the column definition
    const columnData = {
      projectId,
      status,
      columnKey,
      columnName,
      columnType,
      dropdownOptions: columnType === "dropdown" ? dropdownOptions : undefined,
      isRequired: isRequired || false,
      defaultValue: null, // Always null for empty state
      order,
    };

    const newColumn = await createProjectStatusColumn(columnData);

    // Apply default values (null) to all existing tasks with this status in the project
    const existingTasks = await findManyTasks({
      projectId,
      status,
      isActive: true,
    });

    if (existingTasks.length > 0) {
      console.log(`📝 Applying default values to ${existingTasks.length} existing ${status} tasks`);

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

      console.log(`🎉 Successfully applied default values to ${updatedCount} tasks`);
    }

    return generateResponse(
      {
        column: newColumn,
        tasksUpdated: existingTasks.length,
      },
      `Column "${columnName}" created successfully for ${status} status. Applied to ${existingTasks.length} existing tasks.`,
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

