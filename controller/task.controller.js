"use strict";

const { parseBody, generateResponse, deleteFileFromDisk } = require("../utils");
const {
  STATUS_CODES,
  ACTION_TYPE,
  TASK_STATUS,
} = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findProject } = require("../models/projectModel");
const {
  createTask,
  findTask,
  updateTask,
  deleteTask,
  getNextOrderIndex,
} = require("../models/taskModel");
const { createActivity } = require("../models/activityModel");
const { createNotification } = require("../models/notificationModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const { generateActivityMessage } = require("../utils");
const { emitUserNotification, emitTaskEvent, getIO } = require("../utils/socket");
const { emitInboxUnreadUpdate } = require("../utils/inboxNotifications");
const {
  createTaskActivitiesAndNotifications,
  handlePriorityActivity,
  handleDueDateActivity,
  handleAssignmentActivitiesAndNotifications,
  prepareTaskEventPayload,
  handleAttachmentsActivity,
  handleLinksActivity,
  handleColumnValuesActivity,
} = require("./helpers/tasks/task.helper");
const {
  processTaskColumnValues,
  transformStatusColumnValuesToColumnValues,
} = require("./helpers/tasks/statusColumns.helper");
const {
  getTaskByIdQuery,
  getTrendingTasksQuery,
  getRecentActivitiesQuery,
  getUserTasksByFilterQuery,
  getUserPersonalTasksCalendarQuery,
} = require("./queries/tasksQueries");
const { getAllTasks } = require("../models/taskModel");
const Mailer = require("../utils/mailer");
const { generateTaskShareEmail } = require("../utils/emailTemplates");
const { upsertTaskView, getTrendingTasks } = require("../models/taskViewModel");
const { deleteSubtask } = require("../models/subtaskModel");
const { getProjectStatusKeys } = require("../models/tabTaskStatusModel");

// Helper function to parse date strings
const parseDate = (dateString) => {
  if (!dateString) return undefined;

  // If it's already a Date object, return it
  if (dateString instanceof Date) return dateString;

  // Handle DD-MM-YYYY format
  if (
    typeof dateString === "string" &&
    dateString.match(/^\d{2}-\d{2}-\d{4}$/)
  ) {
    const [day, month, year] = dateString.split("-");
    return new Date(year, month - 1, day); // month is 0-indexed
  }

  // Handle other formats (YYYY-MM-DD, ISO, etc.)
  return new Date(dateString);
};

/**
 * Create a new task
 */
exports.createTask = async (req, res, next) => {
  try {
    const {
      title,
      projectId,
      channelId,
      tabId,
      status,
      assignedTo,
      priority,
      dueDate,
      attachments,
      links,
      columnValues,
      tags,
    } = parseBody(req.body);

    const userId = req?.user?.id;
    let project = null;
    let tab = null;
    let channel = null;

    // Validate that either projectId or channelId is provided
    if (!projectId && !channelId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Either projectId or channelId must be provided",
      });
    }

    if (projectId && channelId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Cannot provide both projectId and channelId",
      });
    }

    if (projectId) {
      // Existing flow for project-based tasks
      project = await findProject({ _id: projectId });
      if (!project) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }

      // Check if user is a member of the tab
      tab = await findChannelTab({ _id: project.tabId });
      if (!tab) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab not found",
        });
      }
      const isMember = tab?.members?.includes(userId);
      if (!isMember) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You are not a member of this tab",
        });
      }

      // Find channel
      channel = await findChannel({ _id: project.channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Validate status against project's valid statuses
      if (status) {
        const validStatuses = await getProjectStatusKeys(projectId);
        if (!validStatuses.includes(status)) {
          return next({
            statusCode: STATUS_CODES.BAD_REQUEST,
            message: `Invalid status "${status}". Valid statuses: ${validStatuses.join(", ")}`,
          });
        }
      }
    } else {
      // New flow for channel-based tasks without project (Open tasks)
      // Validate tabId is provided
      if (!tabId) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "tabId is required for open tasks",
        });
      }

      // Validate tab exists
      tab = await findChannelTab({ _id: tabId });
      if (!tab) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab not found",
        });
      }

      // Validate tab belongs to the channel
      if (tab.channelId.toString() !== channelId.toString()) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Tab does not belong to this channel",
        });
      }

      // Check if user is a member of the tab
      const isTabMember = tab?.members?.includes(userId);
      if (!isTabMember) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You are not a member of this tab",
        });
      }

      // Get channel
      channel = await findChannel({ _id: channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }
    }

    // Get creator's info
    const creator = await findUser({ _id: userId });
    if (!creator) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Calculate orderIndex for the task's status (default to "todo" if not provided)
    const taskStatus = status || TASK_STATUS.TODO;
    const orderIndex = await getNextOrderIndex(
      projectId,
      channelId,
      taskStatus
    );

    // Process column values if provided and tab exists (works for both project and open tasks)
    let processedColumnValues = new Map();
    if (tab) {
      const columnProcessResult = await processTaskColumnValues(
        tab._id,
        columnValues || {}
      );

      if (!columnProcessResult.isValid) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Column validation failed",
          errors: columnProcessResult.errors,
        });
      }

      processedColumnValues = new Map(
        Object.entries(columnProcessResult.processedValues)
      );
    }

    // Prepare orderIndex object - use dynamic key to support custom statuses
    const orderIndexes = {
      [taskStatus]: orderIndex,
    };

    // Process attachments to add uploadedBy and uploadedAt if missing
    const processedAttachments = (attachments || []).map(attachment => ({
      ...attachment,
      uploadedBy: attachment.uploadedBy || userId,
      uploadedAt: attachment.uploadedAt || new Date(),
    }));

    // Create task with simplified fields, using defaults for removed ones
    const task = await createTask({
      title: title,
      projectId: projectId || null,
      channelId: projectId ? project.channelId : channelId,
      companyId: channel.companyId,
      tabId: tab ? tab._id : null,
      assignedTo: assignedTo || [],
      status: taskStatus,
      priority: priority || "medium",
      dueDate: parseDate(dueDate) || null,
      attachments: processedAttachments,
      links: links || [],
      statusColumnValues: processedColumnValues,
      // Auto-defaults for removed fields
      description: "",
      tags: tags || [],
      strokeColor: "#6C63FF",
      type: "task",
      customFields: [],
      checklist: [],
      orderIndex: orderIndexes,
      createdBy: userId,
    });

    const contextPath = projectId
      ? `${channel.channelName} / ${tab.tabName}`
      : `${channel.channelName} / Open`;
    const userName = creator.name || creator.email;

    // Initialize activities and notifications arrays
    let activities = [];
    let notifications = [];

    // 1. Handle task creation activities and notifications
    const taskCreationResult = await createTaskActivitiesAndNotifications({
      task,
      projectId: projectId || null,
      userId,
      userName,
      channel,
      tab,
      contextPath,
    });
    notifications = [...notifications, ...taskCreationResult.notifications];

    // 2. Handle priority setting activity (if provided)
    if (priority) {
      const priorityActivity = await handlePriorityActivity({
        priority,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(priorityActivity);
    }

    // 3. Handle due date setting activity (if provided)
    if (dueDate) {
      const dueDateActivity = await handleDueDateActivity({
        dueDate,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(dueDateActivity);
    }

    // 4. Handle assignment activities and notifications (if provided)
    if (assignedTo && assignedTo.length > 0) {
      const assignmentResult = await handleAssignmentActivitiesAndNotifications(
        {
          assignedTo,
          userName,
          task,
          projectId: projectId || null,
          channelId: channelId || null,
          userId,
          channel,
          tab,
          contextPath,
        }
      );
      activities = [...activities, ...assignmentResult.activities];
      notifications = [...notifications, ...assignmentResult.notifications];
    }

    // 5. Handle attachments setting activity (if provided)
    if (attachments && attachments.length > 0) {
      const attachmentsActivity = await handleAttachmentsActivity({
        attachments,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(attachmentsActivity);
    }

    // 6. Handle links setting activity (if provided)
    if (links && links.length > 0) {
      const linksActivity = await handleLinksActivity({
        links,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(linksActivity);
    }

    // 7. Handle column values setting activity (if provided)
    if (columnValues && Object.keys(columnValues).length > 0) {
      const columnValuesActivity = await handleColumnValuesActivity({
        columnValues,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(columnValuesActivity);
    }

    // Save all notifications
    await Promise.all(notifications);

    // Emit socket events
    try {
      // Emit task creation event
      const taskEventPayload = prepareTaskEventPayload({
        task,
        activities,
        channel,
        tab,
        project,
        creator,
        contextPath,
      });
      emitTaskEvent({ ...taskEventPayload, excludeUserId: req.user.id });

      // Emit notifications to assigned users
      if (assignedTo && assignedTo.length > 0) {
        assignedTo.forEach((assigneeId) => {
          if (assigneeId !== creator._id) {
            emitUserNotification(assigneeId, {
              type: "MENTION",
              message: `${userName} assigned you to task "${task.title}"`,
              taskId: task._id,
              context: {
                channelId: channel._id,
                tabId: tab?._id || null,
                projectId: project?._id || null,
                projectName: project?.name || null,
                contextPath,
              },
            });
          }
        });
      }

      // Emit inbox unread count updates
      const socketIo = getIO();
      const affectedUserIds = new Set([
        creator._id.toString(),
        ...(assignedTo || []).map((id) => id.toString()),
      ]);
      for (const uid of affectedUserIds) {
        await emitInboxUnreadUpdate(uid, socketIo);
      }
    } catch (error) {
      console.error("Socket error:", error);
      // Continue even if socket fails
    }

    // Transform task response to use columnValues instead of statusColumnValues
    const enrichedColumnValues = await transformStatusColumnValuesToColumnValues(
      tab?._id,
      task.statusColumnValues
    );
    const taskObj = task.toObject();
    delete taskObj.statusColumnValues;
    const taskWithColumnValues = {
      ...taskObj,
      columnValues: enrichedColumnValues,
    };

    return generateResponse(
      { task: taskWithColumnValues },
      "Task created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createTask:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get task by ID with subtasks and activities
 */
exports.getTaskById = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req.user?.id || null; // Handle both authenticated and guest access

    const query = getTaskByIdQuery(taskId, userId);
    const result = await getAllTasks({
      query,
      page: 1,
      limit: 1,
      responseKey: "task",
    });

    if (!result.task.length) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    const task = result.task[0];

    // Track last viewed (non-blocking) - only if user is authenticated
    if (userId) {
      upsertTaskView({ userId, taskId, when: new Date() }).catch((e) => {
        console.error(
          "Failed to record last viewed for task",
          taskId,
          "by user",
          userId,
          "Error:",
          e?.message
        );
      });
    }

    // Transform statusColumnValues to columnValues
    const enrichedColumnValues = await transformStatusColumnValuesToColumnValues(
      task.tabId,
      task.statusColumnValues
    );
    delete task.statusColumnValues;
    const taskWithColumnValues = {
      ...task,
      columnValues: enrichedColumnValues,
    };

    return generateResponse(
      taskWithColumnValues,
      "Task fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getTaskById:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Batch update task
 */
exports.batchUpdateTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const updates = parseBody(req.body);
    const userId = req.user.id;

    // Find task
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
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

    // Get context - tab, project, and channel
    let project = null;
    let tab = null;
    let channel = null;

    // Get tab directly from task (works for both project and open tasks)
    if (task.tabId) {
      tab = await findChannelTab({ _id: task.tabId });
      if (!tab) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab not found",
        });
      }
    }

    // Get project if it's a project-based task
    if (task.projectId) {
      project = await findProject({ _id: task.projectId });
      if (!project) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }
    }

    // Get channel
    if (task.channelId) {
      channel = await findChannel({ _id: task.channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }
    } else {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Task has no channel association",
      });
    }

    // Store previous values for activity tracking
    const previousValues = {};
    Object.keys(updates).forEach((field) => {
      previousValues[field] = task[field];
    });

    // Validate status against project's valid statuses (if updating status)
    if (updates.status && task.projectId) {
      const validStatuses = await getProjectStatusKeys(task.projectId);
      if (!validStatuses.includes(updates.status)) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Invalid status "${updates.status}". Valid statuses: ${validStatuses.join(", ")}`,
        });
      }
    }

    // Parse dueDate if present
    if (updates.dueDate !== undefined) {
      updates.dueDate = parseDate(updates.dueDate);
    }

    // Handle column values updates if provided (works for both project and open tasks)
    if (updates.columnValues && task.tabId) {
      const columnProcessResult = await processTaskColumnValues(
        task.tabId,
        updates.columnValues
      );

      if (!columnProcessResult.isValid) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Column validation failed",
          errors: columnProcessResult.errors,
        });
      }

      // Merge with existing column values
      const existingColumnValues = task.statusColumnValues || new Map();
      const newColumnValues = new Map(
        Object.entries(columnProcessResult.processedValues)
      );
      const mergedColumnValues = new Map([
        ...existingColumnValues,
        ...newColumnValues,
      ]);

      updates.statusColumnValues = mergedColumnValues;
      delete updates.columnValues; // Remove original field
    }

    // Process attachments to add uploadedBy and uploadedAt if missing
    if (updates.attachments) {
      updates.attachments = updates.attachments.map(attachment => ({
        ...attachment,
        uploadedBy: attachment.uploadedBy || userId,
        uploadedAt: attachment.uploadedAt || new Date(),
      }));
    }

    // Update task with all changes
    const updatedTask = await updateTask(
      { _id: taskId },
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    const contextPath = task.projectId
      ? `${channel.channelName} / ${tab.tabName}`
      : `${channel.channelName} / Open`;
    const userName = user.name || user.email;

    // Create activities and notifications for changed fields using specialized helpers
    let activities = [];
    let notifications = [];

    // Handle priority update (if provided)
    if (updates.priority !== undefined && updates.priority !== previousValues.priority) {
      const priorityActivity = await handlePriorityActivity({
        priority: updates.priority,
        userName,
        task: updatedTask,
        projectId: task.projectId || null,
        channelId: task.channelId || null,
        userId,
      });
      activities.push(priorityActivity);
    }

    // Handle due date update (if provided)
    if (updates.dueDate !== undefined && updates.dueDate !== previousValues.dueDate) {
      const dueDateActivity = await handleDueDateActivity({
        dueDate: updates.dueDate,
        userName,
        task: updatedTask,
        projectId: task.projectId || null,
        channelId: task.channelId || null,
        userId,
      });
      activities.push(dueDateActivity);
    }

    // Handle assignment updates (if provided)
    if (updates.assignedTo !== undefined) {
      const newAssignees = updates.assignedTo.filter(
        (id) => !previousValues.assignedTo?.includes(id.toString())
      );

      if (newAssignees.length > 0) {
        const assignmentResult = await handleAssignmentActivitiesAndNotifications({
          assignedTo: newAssignees,
          userName,
          task: updatedTask,
          projectId: task.projectId || null,
          channelId: task.channelId || null,
          userId,
          channel,
          tab,
          contextPath,
        });
        activities = [...activities, ...assignmentResult.activities];
        notifications = [...notifications, ...assignmentResult.notifications];
      }
    }

    // Handle attachments update (if provided)
    if (updates.attachments !== undefined &&
        JSON.stringify(updates.attachments) !== JSON.stringify(previousValues.attachments)) {
      const attachmentsActivity = await handleAttachmentsActivity({
        attachments: updates.attachments,
        userName,
        task: updatedTask,
        projectId: task.projectId || null,
        channelId: task.channelId || null,
        userId,
      });
      activities.push(attachmentsActivity);
    }

    // Handle links update (if provided)
    if (updates.links !== undefined &&
        JSON.stringify(updates.links) !== JSON.stringify(previousValues.links)) {
      const linksActivity = await handleLinksActivity({
        links: updates.links,
        userName,
        task: updatedTask,
        projectId: task.projectId || null,
        channelId: task.channelId || null,
        userId,
      });
      activities.push(linksActivity);
    }

    // Handle column values update (if provided) - already processed above
    if (updates.statusColumnValues !== undefined) {
      const columnValuesActivity = await handleColumnValuesActivity({
        columnValues: updates.columnValues || {},
        userName,
        task: updatedTask,
        projectId: task.projectId || null,
        channelId: task.channelId || null,
        userId,
      });
      activities.push(columnValuesActivity);
    }

    // Handle other generic field updates (title, description, tags, status, etc.)
    const specialFields = ['priority', 'dueDate', 'assignedTo', 'attachments', 'links', 'statusColumnValues', 'columnValues', 'updatedAt', 'version'];
    for (const [field, value] of Object.entries(updates)) {
      if (specialFields.includes(field)) continue;

      // Check if value actually changed
      if (JSON.stringify(value) === JSON.stringify(previousValues[field])) continue;

      // Determine if this is a creation-like scenario (setting a field for the first time)
      const isFieldCreation =
        previousValues[field] === null ||
        previousValues[field] === undefined ||
        (Array.isArray(previousValues[field]) &&
          previousValues[field].length === 0);

      const message = generateActivityMessage(field, userName, {
        previousValue: previousValues[field],
        newValue: value,
        taskTitle: task.title,
        isCreation: isFieldCreation,
      });

      // Create activity
      const activityData = {
        taskId: task._id,
        userId,
        actionType: ACTION_TYPE.UPDATE_TASK,
        field,
        previousValue: previousValues[field],
        newValue: value,
        message,
        timestamp: new Date(),
      };

      if (task.projectId) {
        activityData.projectId = task.projectId;
      } else {
        activityData.channelId = task.channelId;
      }

      const activity = await createActivity(activityData);
      activities.push(activity);
    }

    // Save all notifications
    await Promise.all(notifications);

    // Emit socket events
    try {
      // Prepare and emit task event using helper
      const taskEventPayload = prepareTaskEventPayload({
        task: updatedTask,
        activities,
        channel,
        tab,
        project,
        creator: user, // updatedBy user
        contextPath,
      });
      // Override type for updates
      taskEventPayload.type = "TASK_UPDATED";
      emitTaskEvent(taskEventPayload);

      // Emit user notifications for mentions
      if (notifications.length > 0) {
        for (const notification of notifications) {
          if (notification.type === "MENTION") {
            emitUserNotification(notification.userId, {
              type: "MENTION",
              message: notification.message,
              taskId: task._id,
              context: {
                channelId: channel._id,
                tabId: tab?._id || null,
                projectId: project?._id || null,
                projectName: project?.name || null,
                contextPath,
              },
            });
          }
        }
      }

      // Emit inbox unread count updates if assignedTo changed
      if (updates.assignedTo !== undefined) {
        const socketIo = getIO();
        const affectedUserIds = new Set([
          task.createdBy.toString(),
          ...(updates.assignedTo || []).map((id) => id.toString()),
          ...(previousValues.assignedTo || []).map((id) => id.toString()),
        ]);
        for (const uid of affectedUserIds) {
          await emitInboxUnreadUpdate(uid, socketIo);
        }
      }
    } catch (error) {
      console.error("Socket error:", error);
      // Continue even if socket fails
    }

    // Transform task response to use columnValues instead of statusColumnValues
    const enrichedColumnValues = await transformStatusColumnValuesToColumnValues(
      task.tabId,
      updatedTask.statusColumnValues
    );
    const taskObj = updatedTask.toObject();
    delete taskObj.statusColumnValues;
    const taskWithColumnValues = {
      ...taskObj,
      columnValues: enrichedColumnValues,
    };

    return generateResponse(
      { task: taskWithColumnValues, activities },
      "Task updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in batchUpdateTask:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Share task with multiple users via email and generate shareable link
 */
exports.shareTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { emails, message, shareType = "both" } = parseBody(req.body);
    const userId = req.user.id;

    // Validate task exists and user has access
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    // Get project and validate user access
    const project = await findProject({ _id: task.projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Get tab and validate user is member
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    // Check if user has permission to share (must be tab member, channel member, or assigned)
    const channel = await findChannel({ _id: project.channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    const canShare =
      channel.members.includes(userId) ||
      tab.members.includes(userId) ||
      task.assignedTo.includes(userId) ||
      task.createdBy.toString() === userId;

    if (!canShare) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have permission to share this task",
      });
    }

    // Get current user for context
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Generate shareable link
    const shareLink = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/shared/task/${taskId}`;

    // Prepare response
    const response = {
      shareLink,
      task: {
        id: task._id,
        title: task.title,
        contextPath: `${channel.channelName} / ${tab.tabName} / ${project.name}`,
      },
      sharedBy: {
        name: currentUser.name,
        email: currentUser.email,
      },
    };

    // Handle email sharing if emails provided
    if (
      emails &&
      Array.isArray(emails) &&
      emails.length > 0 &&
      (shareType === "email" || shareType === "both")
    ) {
      // Validate emails array
      const uniqueEmails = [...new Set(emails)];
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = uniqueEmails.filter(
        (email) => !emailRegex.test(email)
      );

      if (invalidEmails.length > 0) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Invalid email format: ${invalidEmails.join(", ")}`,
        });
      }

      if (uniqueEmails.length > 20) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Cannot share with more than 20 recipients at once",
        });
      }

      const emailResults = [];
      const emailErrors = [];

      // Generate email template
      const emailTemplate = generateTaskShareEmail({
        taskTitle: task.title,
        taskDescription: task.description,
        sharedByName: currentUser.name,
        shareLink,
        contextPath: `${channel.channelName} / ${tab.tabName} / ${project.name}`,
        customMessage: message || "",
      });

      // Process each email
      for (const email of uniqueEmails) {
        try {
          await Mailer.sendEmail({
            email: email,
            subject: `${currentUser.name} shared a task with you: ${task.title}`,
            message: emailTemplate.text,
            html: emailTemplate.html,
            replyTo: currentUser.email,
          });

          emailResults.push(email);
        } catch (emailError) {
          console.error(`Failed to send email to ${email}:`, emailError);
          emailErrors.push(
            `Failed to send email to ${email}: ${emailError.message}`
          );
        }
      }

      response.emailResults = {
        sent: emailResults,
        failed: emailErrors,
        totalSent: emailResults.length,
        totalRequested: uniqueEmails.length,
      };

      if (emailErrors.length > 0) {
        response.emailResults.errors = emailErrors;
      }
    }

    // Determine response message
    let responseMessage = "Task shared successfully";
    if (shareType === "email" && response.emailResults) {
      const { totalSent, totalRequested } = response.emailResults;
      if (totalSent === totalRequested) {
        responseMessage = `Task shared via email with ${totalSent} recipients`;
      } else if (totalSent > 0) {
        responseMessage = `Task shared with ${totalSent} out of ${totalRequested} recipients`;
      } else {
        responseMessage = "Failed to send task emails";
      }
    } else if (shareType === "both" && response.emailResults) {
      responseMessage = `Task link generated and shared via email with ${response.emailResults.totalSent} recipients`;
    }

    return generateResponse(
      response,
      responseMessage,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in shareTask:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to share task",
    });
  }
};

/**
 * Get trending tasks for user (most clicked incomplete tasks)
 */
exports.getTrendingTasks = async (req, res, next) => {
  try {
    const { limit, page, timeframe = "all", projectId, channelId } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get trending tasks query
    const query = getTrendingTasksQuery(userId, {
      timeframe,
      projectId,
      channelId,
    });

    // Execute query with pagination
    const result = await getTrendingTasks({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "trendingTasks",
      sort: { clickCount: -1, lastViewedAt: -1 },
    });

    return generateResponse(
      result,
      "Trending tasks fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getTrendingTasks:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get recent activities for user (all viewed tasks sorted by most recent view)
 */
exports.getRecentActivities = async (req, res, next) => {
  try {
    const { limit, page, projectId, channelId } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get recent activities query
    const query = getRecentActivitiesQuery(userId, { projectId, channelId });

    // Execute query with pagination (sorted by lastViewedAt descending)
    const result = await getTrendingTasks({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "recentActivities",
      sort: { lastViewedAt: -1 }, // Sort by most recent view first
    });

    return generateResponse(
      result,
      "Recent activities fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getRecentActivities:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get user tasks by filter (today/overdue/yesterday)
 */
exports.getUserTasksByFilter = async (req, res, next) => {
  try {
    const { filter, limit, page } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get filtered tasks query
    const query = getUserTasksByFilterQuery(userId, filter);

    // Set sorting based on filter type
    let sortOption = {};
    if (filter === "today" || filter === "overdue") {
      sortOption = { dueDate: 1 }; // Ascending order: earliest due date first
    } else if (filter === "yesterday" || filter === "lastweek") {
      sortOption = { completedAt: -1 }; // Descending order: most recently completed first
    }

    // Get totals for all filters
    const [todayQuery, overdueQuery, yesterdayQuery, lastweekQuery] = await Promise.all([
      getAllTasks({
        query: getUserTasksByFilterQuery(userId, "today"),
        page: 1,
        limit: 1,
        responseKey: "count",
      }),
      getAllTasks({
        query: getUserTasksByFilterQuery(userId, "overdue"),
        page: 1,
        limit: 1,
        responseKey: "count",
      }),
      getAllTasks({
        query: getUserTasksByFilterQuery(userId, "yesterday"),
        page: 1,
        limit: 1,
        responseKey: "count",
      }),
      getAllTasks({
        query: getUserTasksByFilterQuery(userId, "lastweek"),
        page: 1,
        limit: 1,
        responseKey: "count",
      }),
    ]);

    // Execute query with pagination and sorting
    const result = await getAllTasks({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: `${filter}Tasks`,
      sort: sortOption,
    });

    // Add totals to the response
    result.totals = {
      today: todayQuery.pagination.totalItems,
      overdue: overdueQuery.pagination.totalItems,
      yesterday: yesterdayQuery.pagination.totalItems,
      lastweek: lastweekQuery.pagination.totalItems,
    };

    return generateResponse(
      result,
      `${
        filter.charAt(0).toUpperCase() + filter.slice(1)
      } tasks fetched successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUserTasksByFilter:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get user's personal tasks for calendar view (across all channels)
 */
exports.getUserPersonalTasksCalendar = async (req, res, next) => {
  try {
    const { currentDate } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate and parse currentDate
    if (!currentDate) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "currentDate query parameter is required",
      });
    }

    const parsedDate = new Date(currentDate);
    if (isNaN(parsedDate.getTime())) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid currentDate format. Use YYYY-MM-DD",
      });
    }

    // Get the aggregation query for user's personal calendar
    const query = getUserPersonalTasksCalendarQuery(userId, parsedDate);

    // Execute query without pagination to get all tasks for the month
    const tasks = await getAllTasks({
      query,
      page: 1,
      limit: 1000, // Get all tasks for the month
      responseKey: "tasks",
    });

    // Calculate month boundaries for context
    const year = parsedDate.getFullYear();
    const month = parsedDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // Prepare calendar response
    const responseData = {
      tasks: tasks.tasks || [],
      view: "personal-calendar",
      totalTasks: tasks.tasks ? tasks.tasks.length : 0,
      monthInfo: {
        currentDate: parsedDate.toISOString().split("T")[0],
        month: month + 1, // 1-based month
        year,
        monthStart: monthStart.toISOString().split("T")[0],
        monthEnd: monthEnd.toISOString().split("T")[0],
        monthName: monthStart.toLocaleDateString("en-US", { month: "long" }),
      },
    };

    return generateResponse(
      responseData,
      `Personal calendar tasks for ${monthStart.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })} fetched successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUserPersonalTasksCalendar:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Toggle task archive status (archive/unarchive)
 * Toggles isActive between true and false
 */
exports.archiveTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    // Find task
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    // Determine new state (toggle)
    const newIsActiveState = !task.isActive;
    const actionVerb = newIsActiveState ? "unarchived" : "archived";
    const actionVerbPast = newIsActiveState ? "Unarchived" : "Archived";

    // Get user
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get context - tab, project, and channel for permission checks
    let project = null;
    let tab = null;
    let channel = null;

    if (task.projectId) {
      // Project-based task
      project = await findProject({ _id: task.projectId });
      if (!project) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }

      [tab, channel] = await Promise.all([
        findChannelTab({ _id: project.tabId }),
        findChannel({ _id: project.channelId }),
      ]);

      if (!tab || !channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab or channel not found",
        });
      }
    } else if (task.channelId) {
      // Channel-based task (Open task)
      channel = await findChannel({ _id: task.channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Get tab from task
      if (task.tabId) {
        tab = await findChannelTab({ _id: task.tabId });
      }
    } else {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Task has no project or channel association",
      });
    }

    // Check permissions: user must be creator, assignee, or tab/channel member
    const isCreator = task.createdBy.toString() === userId;
    const isAssignee = task.assignedTo.some(id => id.toString() === userId);
    const isTabMember = tab && tab.members.some(id => id.toString() === userId);
    const isChannelMember = channel.members.some(id => id.toString() === userId);

    if (!isCreator && !isAssignee && !isTabMember && !isChannelMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have permission to archive this task",
      });
    }

    // Toggle the task archive status
    const updatedTask = await updateTask(
      { _id: taskId },
      { isActive: newIsActiveState, updatedAt: new Date() },
      { new: true }
    );

    // Create activity
    const userName = user.name || user.email;
    const contextPath = project
      ? `${channel.channelName} / ${tab.tabName} / ${project.name}`
      : tab
      ? `${channel.channelName} / ${tab.tabName} / Open`
      : `${channel.channelName} / Open`;

    const activity = await createActivity({
      taskId: task._id,
      userId,
      actionType: ACTION_TYPE.ARCHIVE_TASK,
      message: {
        forCreator: `You ${actionVerb} "${task.title}"`,
        forOthers: `${userName} ${actionVerb} "${task.title}"`,
      },
      timestamp: new Date(),
      projectId: task.projectId || null,
      channelId: task.channelId || null,
    });

    // Emit socket event (so task appears/disappears from lists in real-time)
    try {
      emitTaskEvent({
        taskId: task._id,
        channelId: channel._id,
        type: newIsActiveState ? "TASK_UNARCHIVED" : "TASK_ARCHIVED",
        payload: {
          task: updatedTask,
          actionBy: {
            _id: user._id,
            name: user.name,
            email: user.email,
          },
          activity,
          contextPath,
          isActive: newIsActiveState,
        },
      });

      // Emit inbox unread count updates to affected users
      const socketIo = getIO();
      const affectedUserIds = new Set([
        task.createdBy.toString(),
        ...(task.assignedTo || []).map((id) => id.toString()),
      ]);
      for (const uid of affectedUserIds) {
        await emitInboxUnreadUpdate(uid, socketIo);
      }
    } catch (socketError) {
      console.error("Error emitting archive/unarchive task socket event:", socketError);
      // Continue even if socket fails
    }

    return generateResponse(
      { task: updatedTask, isActive: newIsActiveState },
      `Task ${actionVerb} successfully`,
      res
    );
  } catch (error) {
    console.error("Error in archiveTask:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete a task permanently (hard delete)
 * Also deletes all related records: activities, notifications, subtasks, inbox entries, attachments
 */
exports.deleteTaskPermanently = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    // Find task
    const task = await findTask({ _id: taskId });
    if (!task) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task not found",
      });
    }

    // Get user
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get context - tab, project, and channel for permission checks
    let project = null;
    let tab = null;
    let channel = null;

    if (task.projectId) {
      // Project-based task
      project = await findProject({ _id: task.projectId });
      if (!project) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }

      [tab, channel] = await Promise.all([
        findChannelTab({ _id: project.tabId }),
        findChannel({ _id: project.channelId }),
      ]);

      if (!tab || !channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab or channel not found",
        });
      }
    } else if (task.channelId) {
      // Channel-based task (Open task)
      channel = await findChannel({ _id: task.channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Get tab from task
      if (task.tabId) {
        tab = await findChannelTab({ _id: task.tabId });
      }
    } else {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Task has no project or channel association",
      });
    }

    // Check permissions: user must be creator or channel admin
    const isCreator = task.createdBy.toString() === userId;
    const isChannelAdmin = channel.members.some(id => id.toString() === userId); // You may want stricter admin check

    if (!isCreator && !isChannelAdmin) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only the task creator or channel admin can permanently delete this task",
      });
    }

    // Delete attachments from disk
    if (task.attachments && task.attachments.length > 0) {
      for (const attachment of task.attachments) {
        const deleteResult = deleteFileFromDisk(attachment.url);
        if (!deleteResult.success) {
          console.warn(`Failed to delete attachment file: ${deleteResult.error}`);
        }
      }
    }

    // Delete related records
    const { Activity } = require("../models/activityModel");
    const { Notification } = require("../models/notificationModel");
    const { TaskInbox } = require("../models/taskInboxModel");
    const { deleteTaskConnectionsByTaskId } = require("../models/taskConnectionModel");

    await Promise.all([
      Activity?.deleteMany({ taskId }) || Promise.resolve(),
      Notification?.deleteMany({ taskId }) || Promise.resolve(),
      deleteSubtask({ taskId }),
      TaskInbox?.deleteMany({ taskId }) || Promise.resolve(),
      deleteTaskConnectionsByTaskId(taskId),
    ]);

    // Delete the task
    await deleteTask({ _id: taskId });

    // Emit socket event (so task is removed from all views)
    try {
      emitTaskEvent({
        taskId: task._id,
        channelId: channel._id,
        type: "TASK_DELETED",
        payload: {
          taskId: task._id,
          deletedBy: {
            _id: user._id,
            name: user.name,
            email: user.email,
          },
        },
      });

      // Emit inbox unread count updates to affected users
      const socketIo = getIO();
      const affectedUserIds = new Set([
        task.createdBy.toString(),
        ...(task.assignedTo || []).map((id) => id.toString()),
      ]);
      for (const uid of affectedUserIds) {
        await emitInboxUnreadUpdate(uid, socketIo);
      }
    } catch (socketError) {
      console.error("Error emitting delete task socket event:", socketError);
      // Continue even if socket fails
    }

    return generateResponse(
      null,
      "Task deleted permanently",
      res
    );
  } catch (error) {
    console.error("Error in deleteTaskPermanently:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
