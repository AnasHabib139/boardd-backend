"use strict";

const { parseBody, generateResponse } = require("../utils");
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
  getNextOrderIndex,
} = require("../models/taskModel");
const { createActivity } = require("../models/activityModel");
const { createNotification } = require("../models/notificationModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const { generateActivityMessage } = require("../utils");
const { emitUserNotification, emitTaskEvent } = require("../utils/socket");
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
      assignedTo,
      priority,
      dueDate,
      attachments,
      links,
      columnValues,
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
    } else {
      // New flow for channel-based tasks without project
      channel = await findChannel({ _id: channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Check if user is a member of the channel
      if (!channel.members.includes(userId)) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You are not a member of this channel",
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

    // Calculate orderIndex for the task's status (always "todo" for new tasks)
    const taskStatus = TASK_STATUS.TODO;
    const orderIndex = await getNextOrderIndex(
      projectId,
      channelId,
      taskStatus
    );

    // Process column values if provided and projectId exists
    let processedColumnValues = new Map();
    if (projectId) {
      const columnProcessResult = await processTaskColumnValues(
        projectId,
        taskStatus,
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

    // Prepare orderIndex object for all statuses
    const orderIndexes = {
      todo: taskStatus === "todo" ? orderIndex : 1000,
      in_progress: taskStatus === "in_progress" ? orderIndex : 1000,
      completed: taskStatus === "completed" ? orderIndex : 1000,
    };

    // Create task with simplified fields, using defaults for removed ones
    const task = await createTask({
      title: title,
      projectId: projectId || null,
      channelId: channelId || null,
      assignedTo: assignedTo || [],
      status: taskStatus,
      priority: priority || "medium",
      dueDate: parseDate(dueDate) || null,
      attachments: attachments || [],
      links: links || [],
      statusColumnValues: processedColumnValues,
      // Auto-defaults for removed fields
      description: "",
      tags: [],
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
      emitTaskEvent(taskEventPayload);

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
    } catch (error) {
      console.error("Socket error:", error);
      // Continue even if socket fails
    }

    return generateResponse(
      { task },
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

    return generateResponse(
      task,
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

    // Get project and user info
    const project = await findProject({ _id: task.projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get tab and channel info for context
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    const channel = await findChannel({ _id: project.channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Store previous values for activity tracking
    const previousValues = {};
    Object.keys(updates).forEach((field) => {
      previousValues[field] = task[field];
    });

    // Parse dueDate if present
    if (updates.dueDate !== undefined) {
      updates.dueDate = parseDate(updates.dueDate);
    }

    // Handle column values updates if provided
    if (updates.columnValues && task.projectId) {
      const columnProcessResult = await processTaskColumnValues(
        task.projectId,
        updates.status || task.status,
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

    // Handle status change column inheritance
    if (updates.status && updates.status !== task.status && task.projectId) {
      const {
        getDefaultColumnValues,
      } = require("./helpers/tasks/statusColumns.helper");
      const defaultColumnValues = await getDefaultColumnValues(
        task.projectId,
        updates.status
      );

      if (Object.keys(defaultColumnValues).length > 0) {
        const existingColumnValues =
          updates.statusColumnValues || task.statusColumnValues || new Map();
        const newDefaults = new Map(Object.entries(defaultColumnValues));

        // Only add defaults for columns that don't already have values
        for (const [key, value] of newDefaults) {
          if (!existingColumnValues.has(key)) {
            existingColumnValues.set(key, value);
          }
        }

        updates.statusColumnValues = existingColumnValues;
      }
    }

    // Update task with all changes
    const updatedTask = await updateTask(
      { _id: taskId },
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    const contextPath = `${channel.channelName} / ${tab.tabName}`;
    const userName = user.name || user.email;

    // Create activities and notifications for each changed field
    const activities = [];
    const notifications = [];

    for (const [field, value] of Object.entries(updates)) {
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

      // Create notifications based on field type
      switch (field) {
        case "assignedTo":
          // Handle new assignees (Mentions)
          const newAssignees = value.filter(
            (id) => !previousValues.assignedTo?.includes(id.toString())
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
          break;

        default:
          // Channel notification for all other updates
          notifications.push(
            createNotification({
              userId: task.createdBy,
              type: "CHANNEL",
              projectId: task.projectId,
              channelId: project.channelId,
              tabId: project.tabId,
              taskId: task._id,
              createdBy: userId,
              title: "Task Update",
              message: message.forOthers,
              contextPath,
            })
          );
      }
    }

    // Save all notifications
    await Promise.all(notifications);

    // Emit task update event
    emitTaskEvent({
      taskId,
      channelId: project.channelId,
      type: "TASK_UPDATED",
      payload: {
        task: updatedTask,
        activities,
        updatedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
      },
    });

    // Emit notifications to relevant users
    notifications.forEach((notification) => {
      emitUserNotification(notification.userId, {
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

    return generateResponse(
      { task: updatedTask, activities },
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
    } else if (filter === "yesterday") {
      sortOption = { completedAt: -1 }; // Descending order: most recently completed first
    }

    // Get totals for all filters
    const [todayQuery, overdueQuery, yesterdayQuery] = await Promise.all([
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
