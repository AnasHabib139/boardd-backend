"use strict";
const socketIO = require("socket.io");
const { Types } = require("mongoose");
const { createActivity } = require("../models/activityModel");
const { initChatSocket } = require("./chatSocket");
const { emitUnreadCountsUpdate } = require("./activityNotifications");
const {
  updateTask,
  findTask,
  updateTaskOrderIndex,
  moveTaskToProject,
  moveTaskToChannel,
  getAllTasks,
} = require("../models/taskModel");
// Removed unused imports: getTaskByIdQuery, updateSubtask
const { findProject } = require("../models/projectModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const { findUser } = require("../models/userModel");
const { createNotification } = require("../models/notificationModel");
const { findUserMutePreferences } = require("../models/userMutePreferencesModel");
const { generateActivityMessage, deleteFileFromDisk } = require("../utils");
const { ACTION_TYPE, TASK_STATUS, TASK_PRIORITY } = require("./constants");
const { processTaskColumnValues, transformStatusColumnValuesToColumnData } = require("../controller/helpers/tasks/statusColumns.helper");

let io;

// Track pending updates to prevent conflicts
const pendingUpdates = new Map();

// Helper function to parse date strings (reused from task controller)
const parseDate = (dateString) => {
  if (!dateString) return undefined;
  if (dateString instanceof Date) return dateString;

  if (
    typeof dateString === "string" &&
    dateString.match(/^\d{2}-\d{2}-\d{4}$/)
  ) {
    const [day, month, year] = dateString.split("-");
    return new Date(year, month - 1, day);
  }

  return new Date(dateString);
};

// Helper function to get essential task details for socket responses
const getEssentialTaskDetails = async (taskId, userId = null) => {
  try {
    // Custom aggregation query with only essential fields
    const query = [
      {
        $match: {
          _id: Types.ObjectId.isValid(taskId) ? new Types.ObjectId(taskId) : null,
        },
      },
      // Lookup creator details
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "creator",
        },
      },
      // Lookup assigned users details
      {
        $lookup: {
          from: "users",
          localField: "assignedTo",
          foreignField: "_id",
          as: "assignees",
        },
      },
      // Unwind creator array
      {
        $unwind: {
          path: "$creator",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Add isOverdue calculation
      {
        $addFields: {
          isOverdue: {
            $cond: {
              if: { $and: ["$dueDate", { $lt: ["$dueDate", new Date()] }] },
              then: true,
              else: false,
            },
          },
        },
      },
      // Project only essential fields
      {
        $project: {
          _id: 1,
          title: 1,
          description: 1,
          projectId: 1,
          channelId: 1,
          status: 1,
          priority: 1,
          dueDate: 1,
          strokeColor: 1,
          isActive: 1,
          orderIndex: 1,
          createdAt: 1,
          updatedAt: 1,
          version: 1,
          isOverdue: 1,
          createdBy: {
            _id: "$creator._id",
            name: "$creator.name",
            email: "$creator.email",
          },
          assignees: {
            $map: {
              input: "$assignees",
              as: "assignee",
              in: {
                _id: "$$assignee._id",
                name: "$$assignee.name",
                email: "$$assignee.email",
              },
            },
          },
        },
      },
    ];
    
    const result = await getAllTasks({
      query,
      page: 1,
      limit: 1,
      responseKey: "task",
    });
    
    if (!result.task.length) {
      return null;
    }
    
    return result.task[0];
  } catch (error) {
    console.error("Error getting essential task details:", error);
    return null;
  }
};

// Validate field values
const validateFieldValue = (field, value) => {
  switch (field) {
    case "status":
      return Object.values(TASK_STATUS).includes(value);
    case "priority":
      return typeof value === "string";
    case "assignedTo":
      return Array.isArray(value);
    case "dueDate":
      return (
        value === null || value instanceof Date || typeof value === "string"
      );
    case "type":
      return typeof value === "string";
    case "attachments":
      return (
        Array.isArray(value) &&
        value.every((item) =>
          typeof item === "object" &&
          typeof item.url === "string"
        )
      );
    case "checklist":
      return (
        Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === "object" &&
            typeof item.name === "string" &&
            typeof item.isCompleted === "boolean" &&
            (item.order === undefined || typeof item.order === "number")
        )
      );
    case "tags":
      return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
      );
    case "title":
    case "description":
    case "strokeColor":
      return typeof value === "string";
    case "customFields":
      return (
        Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === "object" &&
            typeof item.name === "string" &&
            typeof item.type === "string" &&
            item.value !== undefined
        )
      );
    case "columnValues":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
};

// Process task update - ALL FIELDS GET INSTANT DB WRITE
const processTaskUpdate = async (socket, data) => {
  const { taskId, field, value, userId, version } = data;

  try {
    // Validate input
    if (!taskId || !field || userId === undefined) {
      socket.emit("task-update-response", {
        success: false,
        error: "Missing required fields: taskId, field, userId",
        taskId,
        field,
      });
      return;
    }

    // Validate field value
    if (!validateFieldValue(field, value)) {
      socket.emit("task-update-response", {
        success: false,
        error: `Invalid value for field ${field}`,
        taskId,
        field,
        value,
      });
      return;
    }

    // Check for conflicts
    const updateKey = `${taskId}-${field}`;
    if (pendingUpdates.has(updateKey)) {
      socket.emit("task-update-response", {
        success: false,
        error: "Another update is in progress for this field",
        taskId,
        field,
        conflict: true,
      });
      return;
    }

    // Mark as pending
    pendingUpdates.set(updateKey, { userId, timestamp: Date.now() });

    // Find and validate task
    const task = await findTask({ _id: taskId });
    if (!task) {
      socket.emit("task-update-response", {
        success: false,
        error: "Task not found",
        taskId,
        field,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Version check for conflict resolution
    if (version && task.version && task.version > version) {
      socket.emit("task-update-response", {
        success: false,
        error: "Task has been updated by another user",
        taskId,
        field,
        conflict: true,
        currentVersion: task.version,
        providedVersion: version,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Get context - handle both project-based and channel-based tasks
    const user = await findUser({ _id: userId });
    if (!user) {
      socket.emit("task-update-response", {
        success: false,
        error: "User not found",
        taskId,
        field,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    let project = null;
    let tab = null;
    let channel = null;

    if (task.projectId) {
      // Project-based task
      project = await findProject({ _id: task.projectId });
      if (!project) {
        socket.emit("task-update-response", {
          success: false,
          error: "Project not found",
          taskId,
          field,
        });
        pendingUpdates.delete(updateKey);
        return;
      }

      [tab, channel] = await Promise.all([
        findChannelTab({ _id: project.tabId }),
        findChannel({ _id: project.channelId }),
      ]);

      if (!tab || !channel) {
        socket.emit("task-update-response", {
          success: false,
          error: "Tab or channel not found",
          taskId,
          field,
        });
        pendingUpdates.delete(updateKey);
        return;
      }
    } else if (task.channelId) {
      // Channel-based task (Open task)
      channel = await findChannel({ _id: task.channelId });
      if (!channel) {
        socket.emit("task-update-response", {
          success: false,
          error: "Channel not found",
          taskId,
          field,
        });
        pendingUpdates.delete(updateKey);
        return;
      }
    } else {
      socket.emit("task-update-response", {
        success: false,
        error: "Task has no project or channel association",
        taskId,
        field,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Check permissions
    const canUpdate =
      (tab && tab.members.includes(userId)) ||
      channel.members.includes(userId) ||
      task.assignedTo.includes(userId) ||
      task.createdBy.toString() === userId;

    if (!canUpdate) {
      socket.emit("task-update-response", {
        success: false,
        error: "Permission denied",
        taskId,
        field,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    const previousValue = task[field];
    const contextPath = project ? `${channel.channelName} / ${tab.tabName}` : `${channel.channelName} / Open`;
    const userName = user.name || user.email;

    // Track the actual field name for DB update (may differ from original field)
    let dbField = field;

    // Handle attachment deletions before updating
    if (field === "attachments") {
      // Get URLs from new attachment objects
      const newUrls = value.map(att => att.url);

      // Find attachments that were removed
      const removedAttachments = previousValue.filter(
        (attachment) => !newUrls.includes(attachment.url)
      );

      // Delete removed attachments from disk
      for (const attachment of removedAttachments) {
        const deleteResult = deleteFileFromDisk(attachment.url);
        if (!deleteResult.success) {
          console.warn(
            `Failed to delete attachment file: ${deleteResult.error}. Continuing with database update.`
          );
        }
      }
    }

    // Parse value if needed
    let processedValue = value;
    if (field === "dueDate") {
      processedValue = parseDate(value);
    }

    // Convert assignedTo string IDs to ObjectId instances for database
    if (field === "assignedTo" && Array.isArray(processedValue)) {
      processedValue = processedValue.map(id =>
        Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : id
      );
    }

    // Process attachments to add uploadedBy and uploadedAt if missing
    if (field === "attachments" && Array.isArray(processedValue)) {
      processedValue = processedValue.map(attachment => ({
        ...attachment,
        uploadedBy: attachment.uploadedBy || (Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : userId),
        uploadedAt: attachment.uploadedAt || new Date(),
      }));
    }

    // Process columnValues - validate and convert to Map (same as HTTP API)
    if (field === "columnValues" && processedValue) {
      // Get task's tab to validate column values
      let tabId = null;
      if (task.projectId) {
        const taskProject = await findProject({ _id: task.projectId });
        tabId = taskProject?.tabId;
      } else if (task.tabId) {
        tabId = task.tabId;
      }

      if (tabId) {
        // Validate and process column values using the same helper as HTTP API
        const columnProcessResult = await processTaskColumnValues(tabId, processedValue);

        if (!columnProcessResult.isValid) {
          socket.emit("task-update-response", {
            success: false,
            error: "Column validation failed",
            errors: columnProcessResult.errors,
            taskId,
            field,
          });
          pendingUpdates.delete(updateKey);
          return;
        }

        // Merge with existing column values (same as HTTP API)
        const existingColumnValues = task.statusColumnValues || new Map();
        const newColumnValues = new Map(Object.entries(columnProcessResult.processedValues));
        const mergedColumnValues = new Map([...existingColumnValues, ...newColumnValues]);

        // Update dbField to statusColumnValues for DB (keep original field for logging)
        dbField = "statusColumnValues";
        processedValue = mergedColumnValues;
      } else {
        // No tab found - cannot validate column values
        socket.emit("task-update-response", {
          success: false,
          error: "Cannot update column values: task has no associated tab",
          taskId,
          field,
        });
        pendingUpdates.delete(updateKey);
        return;
      }
    }

    // INSTANT DB UPDATE FOR ALL FIELDS
    const updatedTask = await updateTask(
      { _id: taskId },
      {
        [dbField]: processedValue,
        updatedAt: new Date(),
        version: (task.version || 0) + 1,
      },
      { new: true }
    );

    // Create activity with both messages
    let activityMessageData = {
      previousValue,
      newValue: processedValue,
      taskTitle: task.title,
      isCreation: false,
    };

    // Convert user IDs to names for assignedTo field
    if (field === "assignedTo") {
      // Convert to ObjectIds for proper user lookup (processedValue already has ObjectIds from above)
      const assigneeIds = Array.isArray(processedValue) ? processedValue : [];

      if (assigneeIds.length > 0) {
        try {
          const assigneeUsers = await Promise.all(
            assigneeIds.map(id => findUser({ _id: id }))
          );
          const assigneeNames = assigneeUsers
            .filter(user => user)
            .map(user => user.name || user.email);

          activityMessageData.newValue = assigneeNames;
          console.log(`Converted ${assigneeIds.length} assignee IDs to names:`, assigneeNames);
        } catch (error) {
          console.error('Error converting assignee IDs to names:', error);
        }
      } else {
        activityMessageData.newValue = [];
      }

      // Also convert previous value if it exists
      if (previousValue && Array.isArray(previousValue) && previousValue.length > 0) {
        const prevIds = previousValue.map(id =>
          Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : id
        );
        try {
          const prevAssigneeUsers = await Promise.all(
            prevIds.map(id => findUser({ _id: id }))
          );
          const prevAssigneeNames = prevAssigneeUsers
            .filter(user => user)
            .map(user => user.name || user.email);
          activityMessageData.previousValue = prevAssigneeNames;
        } catch (error) {
          console.error('Error converting previous assignee IDs to names:', error);
        }
      }
    }

    const activityMessage = generateActivityMessage(field, userName, activityMessageData);

    const activityData = {
      taskId: task._id,
      userId,
      actionType: ACTION_TYPE.UPDATE_TASK,
      field,
      previousValue,
      newValue: processedValue,
      message: activityMessage,
      timestamp: new Date(),
    };

    if (task.projectId) {
      activityData.projectId = task.projectId;
    } else {
      activityData.channelId = task.channelId;
    }

    const activity = await createActivity(activityData);

    // Handle notifications
    const notifications = [];
    if (field === "assignedTo") {
      const newAssignees = processedValue.filter(
        (id) => !previousValue?.includes(id.toString())
      );

      for (const assigneeId of newAssignees) {
        if (assigneeId.toString() !== userId) {
          notifications.push(
            createNotification({
              userId: assigneeId,
              type: "MENTION",
              projectId: task.projectId || null,
              channelId: channel._id,
              tabId: project?.tabId || null,
              taskId: task._id,
              createdBy: userId,
              title: "Task Assignment",
              message: `${userName} assigned you to task "${task.title}"`,
              contextPath,
            })
          );
        }
      }
    }

    // Save notifications
    if (notifications.length > 0) {
      await Promise.all(notifications);
    }

    // Emit minimal task update response to task room
    io.to(`task:${taskId}`).emit("task-update-response", {
      success: true,
      taskId,
      projectId: task.projectId,
      field,
      previousValue,
      newValue: processedValue,
      version: updatedTask.version,
      activity: {
        _id: activity._id,
        message: activityMessage, // Contains both forCreator and forOthers
        timestamp: activity.timestamp,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
      },
    });

    // Keep tab-activity emission unchanged for notifications
    const notificationMessage = generateTabNotificationMessage("TASK_UPDATED", {
      updatedBy: user,
      task: updatedTask,
      project,
      field,
      newValue: processedValue,
      activities: [activity],
    });

    // Transform statusColumnValues to columnData array if this is a columnValues update
    let taskWithColumnData = updatedTask;
    if (field === "columnValues" && updatedTask.statusColumnValues) {
      try {
        // Get tab ID to fetch column definitions
        let tabIdForColumns = null;
        if (updatedTask.projectId) {
          const taskProject = await findProject({ _id: updatedTask.projectId });
          tabIdForColumns = taskProject?.tabId;
        } else if (updatedTask.tabId) {
          tabIdForColumns = updatedTask.tabId;
        }

        if (tabIdForColumns) {
          const columnData = await transformStatusColumnValuesToColumnData(
            tabIdForColumns,
            updatedTask.statusColumnValues
          );
          const taskObj = updatedTask.toObject ? updatedTask.toObject() : { ...updatedTask };
          delete taskObj.statusColumnValues;
          taskWithColumnData = {
            ...taskObj,
            columnData,
          };
        }
      } catch (error) {
        console.error("Error transforming statusColumnValues to columnData:", error);
        // Continue with original task if transformation fails
      }
    }

    // Emit to channel room (covers all tabs and open tasks)
    io.to(`channel:${channel._id}`).emit("tab-activity", {
      type: "TASK_UPDATED",
      task: taskWithColumnData,
      activities: [activity],
      field,
      previousValue,
      newValue: processedValue,
      updatedBy: {
        _id: user._id,
        name: user.name,
        email: user.email,
      },
      notification: notificationMessage,
      timestamp: new Date(),
    });

    // Emit notifications to assigned users
    notifications.forEach((notification) => {
      exports.emitUserNotification(notification.userId, {
        type: notification.type,
        message: notification.message,
        taskId: task._id,
        context: {
          channelId: channel._id,
          tabId: project?.tabId || null,
          projectId: project?._id || null,
          projectName: project?.name || null,
          contextPath,
        },
      });
    });
  } catch (error) {
    console.error(`Error processing task update for ${taskId}:`, error);
    socket.emit("task-update-response", {
      success: false,
      error: error.message,
      taskId,
      field,
    });
  } finally {
    // Clean up pending update
    const updateKey = `${taskId}-${field}`;
    pendingUpdates.delete(updateKey);
  }
};

// Process task reorder within same project (change status and/or position)
const processTaskReorder = async (socket, data) => {
  const { taskId, newStatus, newOrderIndex, userId } = data;

  try {
    // Validate input
    if (!taskId || !newStatus || userId === undefined) {
      socket.emit("task-reorder-response", {
        success: false,
        error: "Missing required fields: taskId, newStatus, userId",
        taskId,
      });
      return;
    }

    // Validate status
    if (!Object.values(TASK_STATUS).includes(newStatus)) {
      socket.emit("task-reorder-response", {
        success: false,
        error: "Invalid status value",
        taskId,
      });
      return;
    }

    // Check for conflicts
    const updateKey = `${taskId}-reorder`;
    if (pendingUpdates.has(updateKey)) {
      socket.emit("task-reorder-response", {
        success: false,
        error: "Another reorder is in progress for this task",
        taskId,
        conflict: true,
      });
      return;
    }

    // Mark as pending
    pendingUpdates.set(updateKey, { userId, timestamp: Date.now() });

    // Find and validate task
    const task = await findTask({ _id: taskId });
    if (!task) {
      socket.emit("task-reorder-response", {
        success: false,
        error: "Task not found",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Get context for permissions and activity
    const user = await findUser({ _id: userId });
    if (!user) {
      socket.emit("task-reorder-response", {
        success: false,
        error: "User not found",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    let project = null;
    let tab = null;
    let channel = null;

    if (task.projectId) {
      // Project-based task
      project = await findProject({ _id: task.projectId });
      if (!project) {
        socket.emit("task-reorder-response", {
          success: false,
          error: "Project not found",
          taskId,
        });
        pendingUpdates.delete(updateKey);
        return;
      }

      [tab, channel] = await Promise.all([
        findChannelTab({ _id: project.tabId }),
        findChannel({ _id: project.channelId }),
      ]);

      if (!tab || !channel) {
        socket.emit("task-reorder-response", {
          success: false,
          error: "Tab or channel not found",
          taskId,
        });
        pendingUpdates.delete(updateKey);
        return;
      }
    } else if (task.channelId) {
      // Channel-based task (Open task)
      channel = await findChannel({ _id: task.channelId });
      if (!channel) {
        socket.emit("task-reorder-response", {
          success: false,
          error: "Channel not found",
          taskId,
        });
        pendingUpdates.delete(updateKey);
        return;
      }
    } else {
      socket.emit("task-reorder-response", {
        success: false,
        error: "Task has no project or channel association",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Check permissions
    const canReorder =
      (tab && tab.members.includes(userId)) ||
      channel.members.includes(userId) ||
      task.assignedTo.includes(userId) ||
      task.createdBy.toString() === userId;

    if (!canReorder) {
      socket.emit("task-reorder-response", {
        success: false,
        error: "Permission denied",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Calculate order index if not provided (append to end)
    let calculatedOrderIndex = newOrderIndex;
    if (!calculatedOrderIndex) {
      // Get next available order index for this status
      const { getNextOrderIndex } = require("../models/taskModel");
      calculatedOrderIndex = await getNextOrderIndex(task.projectId, task.channelId, newStatus);
    }

    const previousStatus = task.status;
    const contextPath = project ? `${channel.channelName} / ${tab.tabName}` : `${channel.channelName} / Open`;
    const userName = user.name || user.email;

    // Update task status and order index
    const updatedTask = await updateTaskOrderIndex(
      taskId,
      newStatus,
      calculatedOrderIndex
    );

    // If status changed, also update the task status
    if (newStatus !== previousStatus) {
      await updateTask({ _id: taskId }, { status: newStatus }, { new: true });
    }

    // Create activity for the reorder
    const activityMessage = {
      forCreator:
        newStatus !== previousStatus
          ? `You moved "${task.title}" to ${newStatus}`
          : `You reordered "${task.title}"`,
      forOthers:
        newStatus !== previousStatus
          ? `${userName} moved "${task.title}" to ${newStatus}`
          : `${userName} reordered "${task.title}"`,
    };

    const activityData = {
      taskId: task._id,
      userId,
      actionType:
        newStatus !== previousStatus
          ? ACTION_TYPE.UPDATE_TASK
          : ACTION_TYPE.UPDATE_TASK,
      field: newStatus !== previousStatus ? "status" : "orderIndex",
      previousValue:
        newStatus !== previousStatus
          ? previousStatus
          : task.orderIndex?.[previousStatus],
      newValue: newStatus !== previousStatus ? newStatus : calculatedOrderIndex,
      message: activityMessage,
      timestamp: new Date(),
    };

    if (task.projectId) {
      activityData.projectId = task.projectId;
    } else {
      activityData.channelId = task.channelId;
    }

    const activity = await createActivity(activityData);

    // Note: No additional status activity needed for reorder because
    // the main activity already uses field: "status" when status changes

    // Get essential task details for response
    const essentialTask = await getEssentialTaskDetails(taskId, userId);
    
    // Emit success response
    const responseData = {
      success: true,
      taskId,
      newStatus,
      previousStatus,
      orderIndex: calculatedOrderIndex,
      task: essentialTask || {
        _id: task._id,
        title: task.title,
        status: newStatus,
        priority: task.priority,
        strokeColor: task.strokeColor,
      },
      activity: {
        _id: activity._id,
        message: activityMessage,
        timestamp: activity.timestamp,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
      },
    };

    // Emit to channel room (simplified approach - covers all tabs and open tasks)
    io.to(`channel:${channel._id}`).emit("task-reorder-response", responseData);

    // Also emit to task room for users viewing the task (activity updates)
    io.to(`task:${taskId}`).emit("task-update-response", {
      success: true,
      taskId,
      projectId: task.projectId,
      field: "status",
      previousValue: previousStatus,
      newValue: newStatus,
      version: task.version,
      activity: {
        _id: responseData.activity._id,
        message: responseData.activity.message,
        timestamp: responseData.activity.timestamp,
        user: responseData.activity.user,
      },
    });

    // Emit tab activity to channel room
    io.to(`channel:${channel._id}`).emit("tab-activity", {
      type: "TASK_REORDERED",
      task: responseData.task,
      newStatus,
      previousStatus,
      orderIndex: calculatedOrderIndex,
      movedBy: {
        _id: user._id,
        name: user.name,
        email: user.email,
      },
      notification:
        newStatus !== previousStatus
          ? `${userName} moved "${task.title}" to ${newStatus}`
          : `${userName} reordered "${task.title}"`,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error(`Error processing task reorder for ${taskId}:`, error);
    socket.emit("task-reorder-response", {
      success: false,
      error: error.message,
      taskId,
    });
  } finally {
    const updateKey = `${taskId}-reorder`;
    pendingUpdates.delete(updateKey);
  }
};

// Process task move between projects or to/from Open
const processTaskMove = async (socket, data) => {
  const { taskId, newProjectId, newChannelId, newStatus, newOrderIndex, userId } = data;

  try {
    // Validate input - either newProjectId or newChannelId must be provided
    if (!taskId || (!newProjectId && !newChannelId) || !newStatus || userId === undefined) {
      socket.emit("task-move-response", {
        success: false,
        error:
          "Missing required fields: taskId, (newProjectId OR newChannelId), newStatus, userId",
        taskId,
      });
      return;
    }

    // Validate that both newProjectId and newChannelId are not provided
    if (newProjectId && newChannelId) {
      socket.emit("task-move-response", {
        success: false,
        error: "Cannot provide both newProjectId and newChannelId",
        taskId,
      });
      return;
    }

    // Validate status
    if (!Object.values(TASK_STATUS).includes(newStatus)) {
      socket.emit("task-move-response", {
        success: false,
        error: "Invalid status value",
        taskId,
      });
      return;
    }

    // Check for conflicts
    const updateKey = `${taskId}-move`;
    if (pendingUpdates.has(updateKey)) {
      socket.emit("task-move-response", {
        success: false,
        error: "Another move is in progress for this task",
        taskId,
        conflict: true,
      });
      return;
    }

    // Mark as pending
    pendingUpdates.set(updateKey, { userId, timestamp: Date.now() });

    // Find and validate task
    const task = await findTask({ _id: taskId });
    if (!task) {
      socket.emit("task-move-response", {
        success: false,
        error: "Task not found",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Find destination (project or channel)
    let newProject = null;
    let newChannel = null;

    if (newProjectId) {
      newProject = await findProject({ _id: newProjectId });
      if (!newProject) {
        socket.emit("task-move-response", {
          success: false,
          error: "Target project not found",
          taskId,
        });
        pendingUpdates.delete(updateKey);
        return;
      }
    } else {
      newChannel = await findChannel({ _id: newChannelId });
      if (!newChannel) {
        socket.emit("task-move-response", {
          success: false,
          error: "Target channel not found",
          taskId,
        });
        pendingUpdates.delete(updateKey);
        return;
      }
    }

    // Get old project/channel context
    let oldProject = null;
    let oldChannel = null;

    if (task.projectId) {
      oldProject = await findProject({ _id: task.projectId });
    } else if (task.channelId) {
      oldChannel = await findChannel({ _id: task.channelId });
    }

    // Get user and context
    const user = await findUser({ _id: userId });
    if (!user) {
      socket.emit("task-move-response", {
        success: false,
        error: "User not found",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Get tabs and channels for context
    let oldTab = null;
    let newTab = null;
    const sourceChannel = oldChannel || (oldProject ? await findChannel({ _id: oldProject.channelId }) : null);
    const targetChannel = newChannel || (newProject ? await findChannel({ _id: newProject.channelId }) : null);

    if (oldProject) {
      oldTab = await findChannelTab({ _id: oldProject.tabId });
    }
    
    if (newProject) {
      newTab = await findChannelTab({ _id: newProject.tabId });
    }

    // Check permissions for source
    const canMoveFrom =
      (oldTab && oldTab.members.includes(userId)) ||
      (sourceChannel && sourceChannel.members.includes(userId)) ||
      task.assignedTo.includes(userId) ||
      task.createdBy.toString() === userId;

    // Check permissions for target
    const canMoveTo =
      (newTab && newTab.members.includes(userId)) ||
      (targetChannel && targetChannel.members.includes(userId));

    if (!canMoveFrom || !canMoveTo) {
      socket.emit("task-move-response", {
        success: false,
        error: "Permission denied for source or target location",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Calculate order index if not provided (append to end)
    let calculatedOrderIndex = newOrderIndex;
    if (!calculatedOrderIndex) {
      // Get next available order index for target location and status
      const { getNextOrderIndex } = require("../models/taskModel");
      calculatedOrderIndex = await getNextOrderIndex(newProjectId, newChannelId, newStatus);
    }

    const previousStatus = task.status;
    const previousProjectId = task.projectId;
    const previousChannelId = task.channelId;
    const userName = user.name || user.email;

    // Move task based on destination type
    let updatedTask;
    if (newProjectId) {
      // Moving to project
      updatedTask = await moveTaskToProject(
        taskId,
        newProjectId,
        newStatus,
        calculatedOrderIndex
      );
    } else {
      // Moving to channel (Open)
      updatedTask = await moveTaskToChannel(
        taskId,
        newChannelId,
        newStatus,
        calculatedOrderIndex
      );
    }

    // Create activity for the move
    const sourceName = oldProject ? oldProject.name : "Open";
    const targetName = newProject ? newProject.name : "Open";
    
    const activityMessage = {
      forCreator: `You moved "${task.title}" from "${sourceName}" to "${targetName}" (${newStatus})`,
      forOthers: `${userName} moved "${task.title}" from "${sourceName}" to "${targetName}" (${newStatus})`,
    };

    const activityData = {
      taskId: task._id,
      userId,
      actionType: ACTION_TYPE.UPDATE_TASK,
      field: newProjectId ? "projectId" : "channelId",
      previousValue: newProjectId ? previousProjectId : previousChannelId,
      newValue: newProjectId || newChannelId,
      message: activityMessage,
      timestamp: new Date(),
    };

    if (newProjectId) {
      activityData.projectId = newProjectId;
    } else {
      activityData.channelId = newChannelId;
    }

    const activity = await createActivity(activityData);

    // Create additional activity for status change if status changed (for work progress tracking)
    if (newStatus !== previousStatus) {
      const statusActivityData = {
        taskId: task._id,
        userId,
        actionType: ACTION_TYPE.UPDATE_TASK,
        field: "status",
        previousValue: previousStatus,
        newValue: newStatus,
        message: {
          forCreator: `You changed the status to ${newStatus}`,
          forOthers: `${userName} changed the status to ${newStatus}`,
        },
        timestamp: new Date(),
      };

      if (newProjectId) {
        statusActivityData.projectId = newProjectId;
      } else {
        statusActivityData.channelId = newChannelId;
      }

      await createActivity(statusActivityData);
    }

    // Get essential task details for response
    const essentialTask = await getEssentialTaskDetails(taskId, userId);
    
    // Prepare response data
    const responseData = {
      success: true,
      taskId,
      newProjectId: newProjectId || null,
      newChannelId: newChannelId || null,
      previousProjectId: previousProjectId || null,
      previousChannelId: previousChannelId || null,
      newStatus,
      previousStatus,
      orderIndex: calculatedOrderIndex,
      task: essentialTask || {
        _id: task._id,
        title: task.title,
        status: newStatus,
        priority: task.priority,
        strokeColor: task.strokeColor,
        projectId: newProjectId || null,
        channelId: newChannelId || null,
      },
      source: oldProject ? {
        _id: oldProject._id,
        name: oldProject.name,
        type: "project"
      } : {
        _id: oldChannel._id,
        name: "Open",
        type: "channel"
      },
      target: newProject ? {
        _id: newProject._id,
        name: newProject.name,
        type: "project"
      } : {
        _id: newChannel._id,
        name: "Open",
        type: "channel"
      },
      activity: {
        _id: activity._id,
        message: activityMessage,
        timestamp: activity.timestamp,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
      },
    };

    // Determine source and target room IDs (channel-based approach)
    const sourceChannelId = sourceChannel ? sourceChannel._id : oldChannel._id;
    const targetChannelId = targetChannel ? targetChannel._id : newChannel._id;
    const sourceRoomId = `channel:${sourceChannelId}`;
    const targetRoomId = `channel:${targetChannelId}`;

    // Check if same room to avoid duplicates
    const isSameRoom = sourceRoomId === targetRoomId;

    if (isSameRoom) {
      // Same room - emit once with consolidated message
      io.to(sourceRoomId).emit("task-move-response", {
        ...responseData,
        direction: "internal", // Task moved within same room
      });

      // Also emit to task room for users viewing the task (activity updates)
      io.to(`task:${taskId}`).emit("task-update-response", {
        success: true,
        taskId,
        projectId: task.projectId,
        field: "location",
        previousValue: `${sourceName}`,
        newValue: `${targetName}`,
        version: task.version,
        activity: {
          _id: responseData.activity._id,
          message: responseData.activity.message,
          timestamp: responseData.activity.timestamp,
          user: responseData.activity.user,
        },
      });

      io.to(sourceRoomId).emit("tab-activity", {
        type: "TASK_MOVED_WITHIN_ROOM",
        task: responseData.task,
        source: responseData.source,
        target: responseData.target,
        movedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        notification: `${userName} moved "${task.title}" from "${sourceName}" to "${targetName}"`,
        timestamp: new Date(),
      });
    } else {
      // Different rooms - emit to both
      io.to(sourceRoomId).emit("task-move-response", {
        ...responseData,
        direction: "source", // Task removed from this room
      });

      io.to(targetRoomId).emit("task-move-response", {
        ...responseData,
        direction: "target", // Task added to this room
      });

      // Also emit to task room for users viewing the task (activity updates)
      io.to(`task:${taskId}`).emit("task-update-response", {
        success: true,
        taskId,
        projectId: task.projectId,
        field: "location",
        previousValue: `${sourceName}`,
        newValue: `${targetName}`,
        version: task.version,
        activity: {
          _id: responseData.activity._id,
          message: responseData.activity.message,
          timestamp: responseData.activity.timestamp,
          user: responseData.activity.user,
        },
      });

      // Emit activities to both rooms
      io.to(sourceRoomId).emit("tab-activity", {
        type: "TASK_MOVED_OUT",
        task: responseData.task,
        target: responseData.target,
        movedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        notification: `${userName} moved "${task.title}" to "${targetName}"`,
        timestamp: new Date(),
      });

      io.to(targetRoomId).emit("tab-activity", {
        type: "TASK_MOVED_IN",
        task: responseData.task,
        source: responseData.source,
        movedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        notification: `${userName} moved "${task.title}" from "${sourceName}"`,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    console.error(`Error processing task move for ${taskId}:`, error);
    socket.emit("task-move-response", {
      success: false,
      error: error.message,
      taskId,
    });
  } finally {
    const updateKey = `${taskId}-move`;
    pendingUpdates.delete(updateKey);
  }
};

// Initialize socket.io
exports.initSocket = (server) => {
  const allowedOrigins = [
    "http://localhost:3000", // Local development
    "http://localhost:3001", // Alternative local port
    "https://boarddd-frontend.vercel.app", // Production Vercel frontend
    "https://boarddd-frontend-murex.vercel.app", // Production Vercel frontend
    "https://boarddd.ddns.net", // Production backend domain
    "https://www.boarddd.ddns.net", // Production with www
    // Add your frontend domain here
    "http://localhost:5173", // Vite default port
    "http://localhost:4000", // Alternative frontend port
  ];

  io = socketIO(server, {
    cors: {
      origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          console.log("Socket CORS blocked origin:", origin);
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
      allowEIO3: true, // Support for Engine.IO v3 clients
    },
    transports: ["websocket", "polling"], // Enable both transports
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Initialize chat socket handlers
  initChatSocket(io);

  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    // Join user channel for simplified room management
    socket.on("join-user-channel", async (data) => {
      const { userId, channelId } = data;
      console.log(`Socket ${socket.id} joining channel for user: ${userId}`);

      // Leave all previous channel rooms to avoid conflicts
      const socketRooms = Array.from(socket.rooms);
      socketRooms.forEach(room => {
        if (room.startsWith('channel:')) {
          console.log(`Socket ${socket.id} leaving previous channel room: ${room}`);
          socket.leave(room);
        }
      });

      // Join user's personal room for mentions/notifications
      if (userId) {
        console.log(`Socket ${socket.id} joining user room: ${userId}`);
        socket.join(`user:${userId}`);
      }

      // Check if user is muted before joining channel room
      if (channelId && userId) {
        try {
          const mutePrefs = await findUserMutePreferences({ userId });
          const now = new Date();
          
          // Check if user is currently muted and mute hasn't expired
          if (mutePrefs && mutePrefs.isMuted && mutePrefs.muteUntil && mutePrefs.muteUntil > now) {
            console.log(`User ${userId} is muted - not joining channel room ${channelId}`);
            
            // Emit mute status to the user
            socket.emit("mute-status", {
              isMuted: true,
              muteUntil: mutePrefs.muteUntil.toISOString(),
              message: "You are currently muted from notifications",
              channelId
            });
            return;
          }
          
          // If mute has expired, clear it automatically
          if (mutePrefs && mutePrefs.isMuted && mutePrefs.muteUntil && mutePrefs.muteUntil <= now) {
            const { updateUserMutePreferences } = require("../models/userMutePreferencesModel");
            await updateUserMutePreferences(
              { userId },
              {
                isMuted: false,
                muteUntil: null,
                mutedChannels: [],
                updatedAt: new Date(),
              }
            );
            console.log(`Auto-unmuted expired user ${userId}`);
          }
        } catch (error) {
          console.error(`Error checking mute preferences for user ${userId}:`, error);
          // Continue with normal flow if there's an error
        }

        // Join the current channel room (covers all tabs and open tasks)
        console.log(`Socket ${socket.id} joining channel room: ${channelId}`);
        socket.join(`channel:${channelId}`);
        
        // Emit confirmation
        socket.emit("channel-joined", {
          success: true,
          channelId,
          message: "Successfully joined channel"
        });
      }
    });

    // Join specific task room for real-time updates
    socket.on("join-task", (data) => {
      const { taskId } = data;
      console.log(`Socket ${socket.id} joining task room: ${taskId}`);
      socket.join(`task:${taskId}`);
    });

    // Leave specific task room
    socket.on("leave-task", (data) => {
      const { taskId } = data;
      console.log(`Socket ${socket.id} leaving task room: ${taskId}`);
      socket.leave(`task:${taskId}`);
    });

    // Handle real-time task updates
    socket.on("task-update", async (data) => {
      await processTaskUpdate(socket, data);
    });

    // Handle user presence for real-time collaboration
    socket.on("task-editing", (data) => {
      const { taskId, field, userId, userName, isEditing } = data;
      socket.to(`task:${taskId}`).emit("user-editing", {
        taskId,
        field,
        userId,
        userName,
        isEditing,
        socketId: socket.id,
      });
    });

    // Handle task drag and drop within same project
    socket.on("task-reorder", async (data) => {
      await processTaskReorder(socket, data);
    });

    // Handle task drag and drop between projects
    socket.on("task-move", async (data) => {
      await processTaskMove(socket, data);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      // Clean up any pending updates for this socket
      for (const [key, value] of pendingUpdates.entries()) {
        if (value.socketId === socket.id) {
          pendingUpdates.delete(key);
        }
      }
    });
  });

  // Clean up old pending updates (older than 30 seconds)
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of pendingUpdates.entries()) {
      if (now - value.timestamp > 30000) {
        pendingUpdates.delete(key);
      }
    }
  }, 10000);

  return io;
};

// Get io instance
exports.getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

/**
 * Re-export emitUnreadCountsUpdate for backward compatibility
 * Actual implementation is in activityNotifications.js to avoid circular dependencies
 */
exports.emitUnreadCountsUpdate = async (userId, ioInstance = null) => {
  const socketIo = ioInstance || exports.getIO();
  return emitUnreadCountsUpdate(userId, socketIo);
};

// Generate notification message for tab activity
const generateTabNotificationMessage = (type, payload) => {
  const { updatedBy, task, project, field, newValue, activities } = payload;
  const userName = updatedBy?.name || "Someone";
  const taskTitle = task?.title || "a task";
  const projectName = project?.name || "a project";

  switch (type) {
    case "PROJECT_CREATED":
      return {
        title: "New Project Created",
        message: `${userName} created project "${projectName}"`,
        icon: "📁",
        color: "success",
      };

    case "TASK_CREATED":
      return {
        title: "New Task Created",
        message: `${userName} created "${taskTitle}"`,
        icon: "✨",
        color: "success",
      };

    case "TASK_UPDATED":
      let updateMessage = "";
      switch (field) {
        case "status":
          updateMessage = `changed status to "${newValue}"`;
          break;
        case "priority":
          updateMessage = `set priority to "${newValue}"`;
          break;
        case "assignedTo":
          updateMessage = `updated assignments`;
          break;
        case "dueDate":
          updateMessage = `updated due date`;
          break;
        case "title":
          updateMessage = `renamed task to "${newValue}"`;
          break;
        case "description":
          updateMessage = `updated description`;
          break;
        case "tags":
          updateMessage = `updated tags`;
          break;
        case "type":
          updateMessage = `changed type to "${newValue}"`;
          break;
        case "attachments":
          updateMessage = `updated attachments`;
          break;
        case "checklist":
          updateMessage = `updated checklist`;
          break;
        case "customFields":
          updateMessage = `updated custom fields`;
          break;
        case "strokeColor":
          updateMessage = `changed task color`;
          break;
        default:
          updateMessage = `updated ${field}`;
      }

      return {
        title: "Task Updated",
        message: `${userName} ${updateMessage} in "${taskTitle}"`,
        icon: "📝",
        color: "info",
      };

    case "TASK_COMPLETED":
      return {
        title: "Task Completed",
        message: `${userName} completed "${taskTitle}"`,
        icon: "✅",
        color: "success",
      };

    case "TASK_ASSIGNED":
      return {
        title: "Task Assignment",
        message: `${userName} assigned "${taskTitle}"`,
        icon: "👤",
        color: "warning",
      };

    default:
      return {
        title: "Activity Update",
        message: `${userName} made an update`,
        icon: "🔄",
        color: "info",
      };
  }
};

// Single function to emit any task-related updates
exports.emitTaskEvent = (data) => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }

  const { taskId, channelId, type, payload } = data;

  // Emit task-specific update to users viewing the task
  if (taskId) {
    io.to(`task:${taskId}`).emit("task-update-response", {
      type,
      ...payload,
      timestamp: new Date(),
    });
  }

  // Emit to channel for activity feed with notification message
  if (channelId) {
    const notificationMessage = generateTabNotificationMessage(type, payload);

    io.to(`channel:${channelId}`).emit("tab-activity", {
      type,
      ...payload,
      notification: notificationMessage,
      timestamp: new Date(),
    });
  }
};

// Emit notification to specific user
exports.emitUserNotification = (userId, data) => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  io.to(`user:${userId}`).emit("notification", {
    ...data,
    timestamp: new Date(),
  });
};
