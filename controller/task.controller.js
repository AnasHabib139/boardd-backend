"use strict";

const { parseBody, generateResponse } = require("../utils");
const {
  STATUS_CODES,
  ACTION_TYPE,
  TASK_STATUS,
  TASK_PRIORITY,
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
  handleStatusActivity,
  handleDueDateActivity,
  handleAssignmentActivitiesAndNotifications,
  prepareTaskEventPayload,
  handleDescriptionActivity,
  handleTagsActivity,
  handleStrokeColorActivity,
  handleAttachmentsActivity,
  handleCustomFieldsActivity,
  handleChecklistActivity,
} = require("./helpers/tasks/task.helper");
const { getTaskByIdQuery } = require("./queries/tasksQueries");
const { getAllTasks } = require("../models/taskModel");
const Mailer = require("../utils/mailer");
const { generateTaskShareEmail } = require("../utils/emailTemplates");

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
      description,
      projectId,
      channelId,
      assignedTo,
      status,
      priority,
      dueDate,
      tags,
      strokeColor,
      type,
      attachments,
      customFields,
      checklist,
      subtasks,
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

    // Calculate orderIndex for the task's status
    const taskStatus = status || TASK_STATUS.TODO;
    const orderIndex = await getNextOrderIndex(projectId, channelId, taskStatus);

    // Prepare orderIndex object for all statuses
    const orderIndexes = {
      todo: taskStatus === "todo" ? orderIndex : 1000,
      in_progress: taskStatus === "in_progress" ? orderIndex : 1000,
      completed: taskStatus === "completed" ? orderIndex : 1000,
    };

    // Create task with all fields, using defaults for missing ones
    const task = await createTask({
      title: title || "",
      description: description || "",
      projectId: projectId || null,
      channelId: channelId || null,
      assignedTo: assignedTo || [],
      status: taskStatus,
      priority: priority || TASK_PRIORITY.MEDIUM,
      dueDate: parseDate(dueDate) || null,
      tags: tags || [],
      strokeColor: strokeColor || "#6C63FF",
      type: type || "task",
      attachments: attachments || [],
      customFields: customFields || [],
      checklist: checklist || [],
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

    // 2. Handle status setting activity
    const statusActivity = await handleStatusActivity({
      status: taskStatus,
      userName,
      task,
      projectId: projectId || null,
      channelId: channelId || null,
      userId,
    });
    activities.push(statusActivity);

    // 3. Handle priority setting activity
    if (priority) {
      console.log("priority", priority);
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

    // 4. Handle due date setting activity
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

    // 5. Handle assignment activities and notifications
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

    // 6. Handle description setting activity
    if (description && description.trim() !== "") {
      const descriptionActivity = await handleDescriptionActivity({
        description,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(descriptionActivity);
    }

    // 7. Handle tags setting activity
    if (tags && tags.length > 0) {
      const tagsActivity = await handleTagsActivity({
        tags,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(tagsActivity);
    }

    // 8. Handle stroke color setting activity
    if (strokeColor && strokeColor !== "#6C63FF") {
      const strokeColorActivity = await handleStrokeColorActivity({
        strokeColor,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(strokeColorActivity);
    }

    // 9. Handle attachments setting activity
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

    // 10. Handle custom fields setting activity
    if (customFields && customFields.length > 0) {
      const customFieldsActivity = await handleCustomFieldsActivity({
        customFields,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(customFieldsActivity);
    }

    // 11. Handle checklist setting activity
    if (checklist && checklist.length > 0) {
      const checklistActivity = await handleChecklistActivity({
        checklist,
        userName,
        task,
        projectId: projectId || null,
        channelId: channelId || null,
        userId,
      });
      activities.push(checklistActivity);
    }

    // --- Create subtasks if provided ---
    let createdSubtasks = [];
    if (Array.isArray(subtasks) && subtasks.length > 0) {
      for (const subtaskData of subtasks) {
        const subtask = await require("../models/subtaskModel").createSubtask({
          title: subtaskData.title,
          taskId: task._id,
          projectId: projectId || null,
          createdBy: userId,
          assignedTo: subtaskData.assignedTo || [],
        });

        // Activity and notification logic (reuse from createSubtask)
        const createSubtaskMessage = {
          forCreator: `You created subtask "${subtask.title}" for task "${task.title}"`,
          forOthers: `${userName} created subtask "${subtask.title}" for task "${task.title}"`,
        };
        const activityData = {
          taskId: task._id,
          subtaskId: subtask._id,
          userId,
          actionType: ACTION_TYPE.CREATE_SUBTASK,
          timestamp: new Date(),
          message: createSubtaskMessage,
        };

        if (projectId) {
          activityData.projectId = projectId;
        } else {
          activityData.channelId = channelId;
        }

        const activity = await createActivity(activityData);
        activities.push(activity);

        // Notifications for tab members (or channel members for non-project tasks)
        const membersToNotify = tab ? tab.members : channel.members;
        for (const memberId of membersToNotify) {
          await createNotification({
            userId: memberId,
            type: "CHANNEL",
            projectId: projectId || null,
            channelId: channel._id,
            tabId: tab?._id || null,
            taskId: task._id,
            createdBy: userId,
            title: "New Subtask Created",
            message:
              memberId.toString() === userId.toString()
                ? createSubtaskMessage.forCreator
                : createSubtaskMessage.forOthers,
            contextPath,
          });
        }
        // Notifications for assigned users
        if (subtaskData.assignedTo && subtaskData.assignedTo.length > 0) {
          for (const assigneeId of subtaskData.assignedTo) {
            if (assigneeId !== userId) {
              await createNotification({
                userId: assigneeId,
                type: "MENTION",
                projectId: projectId || null,
                channelId: channel._id,
                tabId: tab?._id || null,
                taskId: task._id,
                createdBy: userId,
                title: "Subtask Assignment",
                message: `${userName} assigned you to subtask "${subtask.title}" in task "${task.title}"`,
                contextPath,
              });
            }
          }
        }
        createdSubtasks.push(subtask);
      }
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
      { task, subtasks: createdSubtasks },
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

    return generateResponse(
      result.task[0],
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
      tabId: project.tabId,
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
