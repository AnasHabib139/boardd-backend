"use strict";
const socketIO = require("socket.io");
const { createActivity } = require("../models/activityModel");
const {
  updateTask,
  findTask,
  updateTaskOrderIndex,
  moveTaskToProject,
} = require("../models/taskModel");
const { updateSubtask } = require("../models/subtaskModel");
const { findProject } = require("../models/projectModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const { findUser } = require("../models/userModel");
const { createNotification } = require("../models/notificationModel");
const { generateActivityMessage } = require("../utils");
const { ACTION_TYPE, TASK_STATUS, TASK_PRIORITY } = require("./constants");

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

// Validate field values
const validateFieldValue = (field, value) => {
  switch (field) {
    case "status":
      return Object.values(TASK_STATUS).includes(value);
    case "priority":
      return Object.values(TASK_PRIORITY).includes(value);
    case "assignedTo":
      return Array.isArray(value);
    case "dueDate":
      return (
        value === null || value instanceof Date || typeof value === "string"
      );
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

    // Get context (reusing batch update pattern)
    const [project, user] = await Promise.all([
      findProject({ _id: task.projectId }),
      findUser({ _id: userId }),
    ]);

    if (!project || !user) {
      socket.emit("task-update-response", {
        success: false,
        error: "Project or user not found",
        taskId,
        field,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    const [tab, channel] = await Promise.all([
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

    // Check permissions
    const canUpdate =
      tab.members.includes(userId) ||
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
    const contextPath = `${channel.channelName} / ${tab.tabName}`;
    const userName = user.name || user.email;

    // Parse value if needed
    let processedValue = value;
    if (field === "dueDate") {
      processedValue = parseDate(value);
    }

    // INSTANT DB UPDATE FOR ALL FIELDS
    const updatedTask = await updateTask(
      { _id: taskId },
      {
        [field]: processedValue,
        updatedAt: new Date(),
        version: (task.version || 0) + 1,
      },
      { new: true }
    );

    // Create activity with both messages
    const activityMessage = generateActivityMessage(field, userName, {
      previousValue,
      newValue: processedValue,
      taskTitle: task.title,
      isCreation: false,
    });

    const activity = await createActivity({
      projectId: task.projectId,
      taskId: task._id,
      userId,
      actionType: ACTION_TYPE.UPDATE_TASK,
      field,
      previousValue,
      newValue: processedValue,
      message: activityMessage,
      timestamp: new Date(),
    });

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
              projectId: task.projectId,
              channelId: project.channelId,
              tabId: project.tabId,
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

    io.to(`tab:${project.tabId}`).emit("tab-activity", {
      type: "TASK_UPDATED",
      task: updatedTask,
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
          channelId: project.channelId,
          tabId: project.tabId,
          projectId: project._id,
          projectName: project.name,
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
    const [project, user] = await Promise.all([
      findProject({ _id: task.projectId }),
      findUser({ _id: userId }),
    ]);

    if (!project || !user) {
      socket.emit("task-reorder-response", {
        success: false,
        error: "Project or user not found",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    const [tab, channel] = await Promise.all([
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

    // Check permissions
    const canReorder =
      tab.members.includes(userId) ||
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
      calculatedOrderIndex = await getNextOrderIndex(task.projectId, newStatus);
    }

    const previousStatus = task.status;
    const contextPath = `${channel.channelName} / ${tab.tabName}`;
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

    const activity = await createActivity({
      projectId: task.projectId,
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
    });

    // Emit success response
    const responseData = {
      success: true,
      taskId,
      newStatus,
      previousStatus,
      orderIndex: calculatedOrderIndex,
      task: {
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

    // Emit to all users in the tab
    io.to(`tab:${project.tabId}`).emit("task-reorder-response", responseData);

    // Emit tab activity
    io.to(`tab:${project.tabId}`).emit("tab-activity", {
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

// Process task move between projects
const processTaskMove = async (socket, data) => {
  const { taskId, newProjectId, newStatus, newOrderIndex, userId } = data;

  try {
    // Validate input
    if (!taskId || !newProjectId || !newStatus || userId === undefined) {
      socket.emit("task-move-response", {
        success: false,
        error:
          "Missing required fields: taskId, newProjectId, newStatus, userId",
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

    // Find and validate task and projects
    const [task, newProject] = await Promise.all([
      findTask({ _id: taskId }),
      findProject({ _id: newProjectId }),
    ]);

    if (!task) {
      socket.emit("task-move-response", {
        success: false,
        error: "Task not found",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    if (!newProject) {
      socket.emit("task-move-response", {
        success: false,
        error: "Target project not found",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Get old project
    const oldProject = await findProject({ _id: task.projectId });

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

    // Get tabs and channels for both projects
    const [oldTab, newTab, oldChannel, newChannel] = await Promise.all([
      findChannelTab({ _id: oldProject.tabId }),
      findChannelTab({ _id: newProject.tabId }),
      findChannel({ _id: oldProject.channelId }),
      findChannel({ _id: newProject.channelId }),
    ]);

    // Check permissions for both projects
    const canMoveFrom =
      oldTab.members.includes(userId) ||
      oldChannel.members.includes(userId) ||
      task.assignedTo.includes(userId) ||
      task.createdBy.toString() === userId;

    const canMoveTo =
      newTab.members.includes(userId) || newChannel.members.includes(userId);

    if (!canMoveFrom || !canMoveTo) {
      socket.emit("task-move-response", {
        success: false,
        error: "Permission denied for source or target project",
        taskId,
      });
      pendingUpdates.delete(updateKey);
      return;
    }

    // Calculate order index if not provided (append to end)
    let calculatedOrderIndex = newOrderIndex;
    if (!calculatedOrderIndex) {
      // Get next available order index for this project and status
      const { getNextOrderIndex } = require("../models/taskModel");
      calculatedOrderIndex = await getNextOrderIndex(newProjectId, newStatus);
    }

    const previousStatus = task.status;
    const previousProjectId = task.projectId;
    const userName = user.name || user.email;

    // Move task to new project with new status and order
    const updatedTask = await moveTaskToProject(
      taskId,
      newProjectId,
      newStatus,
      calculatedOrderIndex
    );

    // Create activity for the move
    const activityMessage = {
      forCreator: `You moved "${task.title}" from "${oldProject.name}" to "${newProject.name}" (${newStatus})`,
      forOthers: `${userName} moved "${task.title}" from "${oldProject.name}" to "${newProject.name}" (${newStatus})`,
    };

    const activity = await createActivity({
      projectId: newProjectId, // Activity belongs to new project
      taskId: task._id,
      userId,
      actionType: ACTION_TYPE.UPDATE_TASK,
      field: "projectId",
      previousValue: previousProjectId,
      newValue: newProjectId,
      message: activityMessage,
      timestamp: new Date(),
    });

    // Prepare response data
    const responseData = {
      success: true,
      taskId,
      newProjectId,
      previousProjectId,
      newStatus,
      previousStatus,
      orderIndex: calculatedOrderIndex,
      task: {
        _id: task._id,
        title: task.title,
        status: newStatus,
        priority: task.priority,
        strokeColor: task.strokeColor,
        projectId: newProjectId,
      },
      sourceProject: {
        _id: oldProject._id,
        name: oldProject.name,
      },
      targetProject: {
        _id: newProject._id,
        name: newProject.name,
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

    // Emit to both old and new tabs (check if same tab to avoid duplicates)
    const isSameTab =
      oldProject.tabId.toString() === newProject.tabId.toString();

    if (isSameTab) {
      // Same tab - emit once with consolidated message
      io.to(`tab:${oldProject.tabId}`).emit("task-move-response", {
        ...responseData,
        direction: "internal", // Task moved within same tab
      });

      io.to(`tab:${oldProject.tabId}`).emit("tab-activity", {
        type: "TASK_MOVED_WITHIN_TAB",
        task: responseData.task,
        sourceProject: responseData.sourceProject,
        targetProject: responseData.targetProject,
        movedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        notification: `${userName} moved "${task.title}" from "${oldProject.name}" to "${newProject.name}"`,
        timestamp: new Date(),
      });
    } else {
      // Different tabs - emit to both tabs
      io.to(`tab:${oldProject.tabId}`).emit("task-move-response", {
        ...responseData,
        direction: "source", // Task removed from this tab
      });

      io.to(`tab:${newProject.tabId}`).emit("task-move-response", {
        ...responseData,
        direction: "target", // Task added to this tab
      });

      // Emit tab activities to both tabs
      io.to(`tab:${oldProject.tabId}`).emit("tab-activity", {
        type: "TASK_MOVED_OUT",
        task: responseData.task,
        targetProject: responseData.targetProject,
        movedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        notification: `${userName} moved "${task.title}" to "${newProject.name}"`,
        timestamp: new Date(),
      });

      io.to(`tab:${newProject.tabId}`).emit("tab-activity", {
        type: "TASK_MOVED_IN",
        task: responseData.task,
        sourceProject: responseData.sourceProject,
        movedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        notification: `${userName} moved "${task.title}" from "${oldProject.name}"`,
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

  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    // Join all accessible tabs for a user
    socket.on("join-user-tabs", async (data) => {
      const { userId, tabs } = data;
      console.log(`Socket ${socket.id} joining tabs for user: ${userId}`);

      // Join user's personal room for mentions/notifications
      if (userId) {
        console.log(`Socket ${socket.id} joining user room: ${userId}`);
        socket.join(`user:${userId}`);
      }

      // Join all tab rooms the user has access to
      if (Array.isArray(tabs)) {
        tabs.forEach((tabId) => {
          console.log(`Socket ${socket.id} joining tab room: ${tabId}`);
          socket.join(`tab:${tabId}`);
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

  const { taskId, tabId, type, payload } = data;

  // Emit task-specific update to users viewing the task
  if (taskId) {
    io.to(`task:${taskId}`).emit("task-update-response", {
      type,
      ...payload,
      timestamp: new Date(),
    });
  }

  // Emit to tab for activity feed with notification message
  if (tabId) {
    const notificationMessage = generateTabNotificationMessage(type, payload);

    io.to(`tab:${tabId}`).emit("tab-activity", {
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
