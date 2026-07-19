"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findProject } = require("../models/projectModel");
const { findManyTasks, updateTask } = require("../models/taskModel");
const {
  createTabTaskStatus,
  findTabTaskStatus,
  findManyTabTaskStatuses,
  updateTabTaskStatus,
  deleteTabTaskStatus,
  getNextStatusOrder,
  initializeSystemStatuses,
  hasStatusesInitialized,
} = require("../models/tabTaskStatusModel");
const { getIO } = require("../utils/socket");

/**
 * Get all statuses for a project
 * GET /api/project-statuses/projects/:projectId/statuses
 */
exports.getProjectStatuses = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    // Verify project exists and user has access
    const project = await findProject({ _id: projectId, isActive: true });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Initialize statuses if not exists
    const hasStatuses = await hasStatusesInitialized(projectId);
    if (!hasStatuses) {
      await initializeSystemStatuses(projectId);
    }

    // Get all statuses ordered
    const statuses = await findManyTabTaskStatuses({ projectId, isActive: true });

    return generateResponse(
      { statuses },
      "Statuses retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getProjectStatuses:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to get statuses",
    });
  }
};

/**
 * Create a new custom status
 * POST /api/project-statuses/projects/:projectId/statuses
 */
exports.createStatus = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { statusName, color } = parseBody(req.body);
    const userId = req.user.id;

    // Verify project exists
    const project = await findProject({ _id: projectId, isActive: true });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Initialize statuses if not exists
    const hasStatuses = await hasStatusesInitialized(projectId);
    if (!hasStatuses) {
      await initializeSystemStatuses(projectId);
    }

    // Generate unique statusKey
    const statusKey = `status_${Date.now()}`;

    // Get next order
    const order = await getNextStatusOrder(projectId);

    // Create the status
    const newStatus = await createTabTaskStatus({
      projectId,
      statusKey,
      statusName,
      color: color || "#6B7280",
      order,
      isSystem: false,
      isActive: true,
    });

    // Emit socket event
    const io = getIO();
    const allStatuses = await findManyTabTaskStatuses({ projectId, isActive: true });
    io.to(`channel:${project.channelId}`).emit("tab-activity", {
      type: "PROJECT_STATUS_CREATED",
      projectId,
      statuses: allStatuses,
      timestamp: new Date(),
    });

    return generateResponse(
      { status: newStatus },
      "Status created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to create status",
    });
  }
};

/**
 * Update a status (name, color, order)
 * PATCH /api/project-statuses/projects/:projectId/statuses/:statusId
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { projectId, statusId } = req.params;
    const { statusName, color, order } = parseBody(req.body);
    const userId = req.user.id;

    // Verify project exists
    const project = await findProject({ _id: projectId, isActive: true });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Find the status
    const status = await findTabTaskStatus({ _id: statusId, projectId });
    if (!status) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Status not found",
      });
    }

    // Build update object (only provided fields)
    const updateData = {};
    if (statusName !== undefined) updateData.statusName = statusName;
    if (color !== undefined) updateData.color = color;
    if (order !== undefined) updateData.order = order;

    if (Object.keys(updateData).length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "No fields to update",
      });
    }

    // Update the status
    const updatedStatus = await updateTabTaskStatus(
      { _id: statusId },
      updateData
    );

    // Emit socket event
    const io = getIO();
    const allStatuses = await findManyTabTaskStatuses({ projectId, isActive: true });
    io.to(`channel:${project.channelId}`).emit("tab-activity", {
      type: "PROJECT_STATUS_UPDATED",
      projectId,
      statuses: allStatuses,
      timestamp: new Date(),
    });

    return generateResponse(
      { status: updatedStatus },
      "Status updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update status",
    });
  }
};

/**
 * Mark/unmark a status as "closes the task"
 * PATCH /api/project-statuses/projects/:projectId/statuses/:statusId/closing
 */
exports.updateStatusClosingFlag = async (req, res, next) => {
  try {
    const { projectId, statusId } = req.params;
    const { isCompletedStatus } = parseBody(req.body);

    const project = await findProject({ _id: projectId, isActive: true });
    if (!project) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Project not found" });
    }

    const status = await findTabTaskStatus({ _id: statusId, projectId });
    if (!status) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Status not found" });
    }

    if (status.isSystem && (status.statusKey === "todo" || status.statusKey === "in_progress")) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Cannot change closing status for To Do / In Progress",
      });
    }

    if (status.statusKey === "completed" && isCompletedStatus === false) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Completed status must always be closing",
      });
    }

    const updatedStatus = await updateTabTaskStatus({ _id: statusId }, { isCompletedStatus });

    // Cascade: bring every existing Task/Subtask in this status in line with
    // the new flag. Bulk updateMany — Mongoose document hooks don't fire on
    // it, which is fine here since we already know the exact correct value.
    const { TaskModel } = require("../models/taskModel");
    const { SubtaskModel } = require("../models/subtaskModel");
    const [taskResult, subtaskResult] = await Promise.all([
      TaskModel.updateMany(
        { projectId, status: status.statusKey },
        { $set: { isClosingStatus: isCompletedStatus, updatedAt: new Date() } }
      ),
      SubtaskModel.updateMany(
        { projectId, status: status.statusKey },
        { $set: { isCompleted: isCompletedStatus, updatedAt: new Date() } }
      ),
    ]);

    const io = getIO();
    const allStatuses = await findManyTabTaskStatuses({ projectId, isActive: true });
    io.to(`channel:${project.channelId}`).emit("tab-activity", {
      type: "PROJECT_STATUS_UPDATED",
      projectId,
      statuses: allStatuses,
      timestamp: new Date(),
    });

    return generateResponse(
      {
        status: updatedStatus,
        tasksUpdated: taskResult.modifiedCount,
        subtasksUpdated: subtaskResult.modifiedCount,
      },
      "Status closing flag updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateStatusClosingFlag:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update status closing flag",
    });
  }
};

/**
 * Delete a custom status
 * DELETE /api/project-statuses/projects/:projectId/statuses/:statusId
 */
exports.deleteStatus = async (req, res, next) => {
  try {
    const { projectId, statusId } = req.params;
    const userId = req.user.id;

    // Verify project exists
    const project = await findProject({ _id: projectId, isActive: true });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Find the status
    const status = await findTabTaskStatus({ _id: statusId, projectId });
    if (!status) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Status not found",
      });
    }

    // Cannot delete system statuses
    if (status.isSystem) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Cannot delete system statuses (To Do, In Progress, Completed)",
      });
    }

    // Move all tasks with this status to "todo"
    const tasksWithStatus = await findManyTasks({ projectId, status: status.statusKey, isActive: true });

    if (tasksWithStatus.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < tasksWithStatus.length; i += batchSize) {
        const batch = tasksWithStatus.slice(i, i + batchSize);
        await Promise.all(
          batch.map((task) =>
            updateTask(
              { _id: task._id },
              { status: "todo", updatedAt: new Date() }
            )
          )
        );
      }
    }

    // Delete the status
    await deleteTabTaskStatus({ _id: statusId });

    // Emit socket event
    const io = getIO();
    const allStatuses = await findManyTabTaskStatuses({ projectId, isActive: true });
    io.to(`channel:${project.channelId}`).emit("tab-activity", {
      type: "PROJECT_STATUS_DELETED",
      projectId,
      statuses: allStatuses,
      deletedStatusKey: status.statusKey,
      migratedToKey: "todo",
      affectedTasks: tasksWithStatus.length,
      timestamp: new Date(),
    });

    return generateResponse(
      { deletedStatusKey: status.statusKey, migratedTasks: tasksWithStatus.length },
      "Status deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to delete status",
    });
  }
};

/**
 * Reorder statuses
 * POST /api/project-statuses/projects/:projectId/statuses/reorder
 */
exports.reorderStatuses = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { statusOrders } = parseBody(req.body); // [{ statusId, order }, ...]
    const userId = req.user.id;

    // Verify project exists
    const project = await findProject({ _id: projectId, isActive: true });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    if (!statusOrders || !Array.isArray(statusOrders)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "statusOrders array is required",
      });
    }

    // Update orders
    await Promise.all(
      statusOrders.map(({ statusId, order }) =>
        updateTabTaskStatus({ _id: statusId, projectId }, { order })
      )
    );

    // Emit socket event
    const io = getIO();
    const allStatuses = await findManyTabTaskStatuses({ projectId, isActive: true });
    io.to(`channel:${project.channelId}`).emit("tab-activity", {
      type: "PROJECT_STATUS_REORDERED",
      projectId,
      statuses: allStatuses,
      timestamp: new Date(),
    });

    return generateResponse(
      { statuses: allStatuses },
      "Statuses reordered successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in reorderStatuses:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to reorder statuses",
    });
  }
};
