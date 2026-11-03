const { createActivity, deleteManyActivities } = require("../../../models/activityModel");
const { createNotification, deleteManyNotifications } = require("../../../models/notificationModel");
const { TaskModel } = require("../../../models/taskModel");
const { SubtaskModel } = require("../../../models/subtaskModel");
const { TaskInbox } = require("../../../models/taskInboxModel");
const { TaskConnectionModel } = require("../../../models/taskConnectionModel");
const { TaskCommentModel } = require("../../../models/taskCommentModel");
const { removeAllReactionsForComments } = require("../../../models/taskCommentReactionModel");
const { TaskViewModel } = require("../../../models/taskViewModel");
const { FormResponseModel } = require("../../../models/formResponseModel");
const { findManyUsers } = require("../../../models/userModel");
const { generateActivityMessage, deleteFileFromDisk } = require("../../../utils");
const { ACTION_TYPE } = require("../../../utils/constants");
/**
 * Create task creation activity and notifications
 */
exports.createTaskActivitiesAndNotifications = async ({
  task,
  projectId,
  userId,
  userName,
  channel,
  tab,
  contextPath,
}) => {
  const activities = [];
  const notifications = [];

  // 1. Task Creation Activity
  const createTaskMessage = {
    forCreator: `You created task "${task.title}"`,
    forOthers: `${userName} created task "${task.title}"`,
  };

  // Create activity with proper context (projectId, tabId, or channelId)
  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.CREATE_TASK,
    timestamp: new Date(),
    message: createTaskMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else if (tab) {
    activityData.tabId = tab._id;
  } else {
    activityData.channelId = channel._id;
  }

  activities.push(await createActivity(activityData));

  // Task creation notification for all relevant members
  const membersToNotify = tab ? tab.members : channel.members;
  for (const memberId of membersToNotify) {
    notifications.push(
      createNotification({
        userId: memberId,
        type: "CHANNEL",
        projectId: projectId || null,
        channelId: channel._id,
        tabId: tab?._id || null,
        taskId: task._id,
        createdBy: userId,
        title: "New Task Created",
        message:
          memberId.toString() === userId.toString()
            ? createTaskMessage.forCreator
            : createTaskMessage.forOthers,
        contextPath,
      })
    );
  }

  return { activities, notifications };
};

/**
 * Handle priority setting activity
 */
exports.handlePriorityActivity = async ({
  priority,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const priorityMessage = generateActivityMessage("priority", userName, {
    previousValue: null,
    newValue: priority,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.CHANGE_PRIORITY,
    field: "priority",
    newValue: priority,
    timestamp: new Date(),
    message: priorityMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle status setting activity
 */
exports.handleStatusActivity = async ({
  status,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const statusMessage = generateActivityMessage("status", userName, {
    previousValue: null,
    newValue: status,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.CHANGE_STATUS,
    field: "status",
    newValue: status,
    timestamp: new Date(),
    message: statusMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle due date setting activity
 */
exports.handleDueDateActivity = async ({
  dueDate,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const dueDateMessage = generateActivityMessage("dueDate", userName, {
    previousValue: null,
    newValue: dueDate,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.CHANGE_DUE_DATE,
    field: "dueDate",
    newValue: dueDate,
    timestamp: new Date(),
    message: dueDateMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle assignment activities and notifications
 */
exports.handleAssignmentActivitiesAndNotifications = async ({
  assignedTo,
  userName,
  task,
  projectId,
  channelId,
  userId,
  channel,
  tab,
  contextPath,
}) => {
  const activities = [];
  const notifications = [];

  // Get assignee details
  const assignees = await findManyUsers({ _id: { $in: assignedTo } });
  const assigneeNames = assignees
    .map((user) => user.name || user.email)
    .join(", ");

  const assignmentMessage = generateActivityMessage("assignedTo", userName, {
    previousValue: [],
    newValue: assigneeNames,
    taskTitle: task.title,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.ASSIGN_USER,
    field: "assignedTo",
    newValue: assignedTo,
    timestamp: new Date(),
    message: assignmentMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  activities.push(await createActivity(activityData));

  // Create notifications for assigned users
  for (const assigneeId of assignedTo) {
    notifications.push(
      createNotification({
        userId: assigneeId,
        type: "MENTION",
        projectId: projectId || null,
        channelId: channel._id,
        tabId: tab?._id || null,
        taskId: task._id,
        createdBy: userId,
        title: "Task Assignment",
        message:
          assigneeId === userId
            ? assignmentMessage.forCreator
            : assignmentMessage.forOthers,
        contextPath,
      })
    );
  }

  return { activities, notifications };
};

/**
 * Handle unassignment activities and notifications
 */
exports.handleUnassignmentActivitiesAndNotifications = async ({
  removedAssignees,
  userName,
  task,
  projectId,
  channelId,
  userId,
  channel,
  tab,
  contextPath,
}) => {
  const activities = [];
  const notifications = [];

  const removedUsers = await findManyUsers({ _id: { $in: removedAssignees } });
  const removedNames = removedUsers.map((user) => user.name || user.email).join(", ");

  const unassignMessage = {
    forCreator: `You removed ${removedNames} from "${task.title}"`,
    forOthers: `${userName} removed ${removedNames} from "${task.title}"`,
  };

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UNASSIGN_USER,
    field: "assignedTo",
    newValue: removedAssignees,
    timestamp: new Date(),
    message: unassignMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  activities.push(await createActivity(activityData));

  // Notify removed users
  for (const removedUserId of removedAssignees) {
    notifications.push(
      createNotification({
        userId: removedUserId,
        type: "MENTION",
        projectId: projectId || null,
        channelId: channel._id,
        tabId: tab?._id || null,
        taskId: task._id,
        createdBy: userId,
        title: "Task Unassignment",
        message:
          removedUserId === userId
            ? unassignMessage.forCreator
            : unassignMessage.forOthers,
        contextPath,
      })
    );
  }

  return { activities, notifications };
};

/**
 * Prepare task event payload
 */
exports.prepareTaskEventPayload = ({
  task,
  activities,
  channel,
  tab,
  project,
  creator,
  contextPath,
}) => ({
  taskId: task._id,
  channelId: channel._id,
  type: "TASK_CREATED",
  payload: {
    task,
    activities,
    context: {
      channelId: channel._id,
      tabId: tab?._id || null,
      projectId: project?._id || null,
      projectName: project?.name || null,
      contextPath,
    },
    updatedBy: {
      _id: creator._id,
      name: creator.name,
      email: creator.email,
    },
  },
});

/**
 * Handle description setting activity
 */
exports.handleDescriptionActivity = async ({
  description,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const descriptionMessage = generateActivityMessage("description", userName, {
    previousValue: null,
    newValue: description,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "description",
    newValue: description,
    timestamp: new Date(),
    message: descriptionMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle tags setting activity
 */
exports.handleTagsActivity = async ({
  tags,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const tagsMessage = generateActivityMessage("tags", userName, {
    previousValue: [],
    newValue: tags,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "tags",
    newValue: tags,
    timestamp: new Date(),
    message: tagsMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle stroke color setting activity
 */
exports.handleStrokeColorActivity = async ({
  strokeColor,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const strokeColorMessage = generateActivityMessage("strokeColor", userName, {
    previousValue: null,
    newValue: strokeColor,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "strokeColor",
    newValue: strokeColor,
    timestamp: new Date(),
    message: strokeColorMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle attachments setting activity
 */
exports.handleAttachmentsActivity = async ({
  attachments,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const attachmentsMessage = generateActivityMessage("attachments", userName, {
    previousValue: [],
    newValue: attachments,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "attachments",
    newValue: attachments,
    timestamp: new Date(),
    message: attachmentsMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle links setting activity
 */
exports.handleLinksActivity = async ({
  links,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const linksMessage = generateActivityMessage("links", userName, {
    previousValue: [],
    newValue: links,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "links",
    newValue: links,
    timestamp: new Date(),
    message: linksMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle column values setting activity
 */
exports.handleColumnValuesActivity = async ({
  columnValues,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const columnValuesMessage = generateActivityMessage("columnValues", userName, {
    previousValue: {},
    newValue: columnValues,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "columnValues",
    newValue: columnValues,
    timestamp: new Date(),
    message: columnValuesMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle custom fields setting activity
 */
exports.handleCustomFieldsActivity = async ({
  customFields,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const customFieldsMessage = generateActivityMessage(
    "customFields",
    userName,
    {
      previousValue: [],
      newValue: customFields,
      taskTitle: task.title,
      isCreation: true,
    }
  );

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "customFields",
    newValue: customFields,
    timestamp: new Date(),
    message: customFieldsMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

/**
 * Handle checklist setting activity
 */
exports.handleChecklistActivity = async ({
  checklist,
  userName,
  task,
  projectId,
  channelId,
  userId,
}) => {
  const checklistMessage = generateActivityMessage("checklist", userName, {
    previousValue: [],
    newValue: checklist,
    taskTitle: task.title,
    isCreation: true,
  });

  const activityData = {
    taskId: task._id,
    userId,
    actionType: ACTION_TYPE.UPDATE_TASK,
    field: "checklist",
    newValue: checklist,
    timestamp: new Date(),
    message: checklistMessage,
  };

  if (projectId) {
    activityData.projectId = projectId;
  } else {
    activityData.channelId = channelId;
  }

  return createActivity(activityData);
};

exports.normalizeAttachments = (attachments, userId) =>
  (attachments || []).map((attachment) => ({
    ...attachment,
    uploadedBy: attachment.uploadedBy || userId,
    uploadedAt: attachment.uploadedAt || new Date(),
  }));

exports.diffAssigneeIds = (previousAssignedTo, currentAssignedTo) => {
  const previous = (previousAssignedTo || []).map((id) => id.toString());
  const current = (currentAssignedTo || []).map((id) => id.toString());
  return {
    added: current.filter((id) => !previous.includes(id)),
    removed: previous.filter((id) => !current.includes(id)),
  };
};

/**
 * Delete attachment files from disk unless something outside the records being deleted still uses them.
 * Files can be shared: duplicateProject copies attachment URLs, form-response tasks reuse the response's file URLs.
 * @param {string[]} urls - attachment URLs of the records being deleted
 * @param {{taskIds?: ObjectId[], subtaskIds?: ObjectId[]}} exclude - records being deleted (their refs don't count)
 */
const deleteUnreferencedFiles = async (urls, { taskIds = [], subtaskIds = [] } = {}) => {
  urls = [...new Set(urls.filter(Boolean))];
  if (!urls.length) return;

  const inUrls = { "attachments.url": { $in: urls } };
  const used = await Promise.all([
    TaskModel.distinct("attachments.url", { _id: { $nin: taskIds }, ...inUrls }),
    SubtaskModel.distinct("attachments.url", { _id: { $nin: subtaskIds }, ...inUrls }),
    FormResponseModel.distinct("responses.value", { "responses.value": { $in: urls } }),
  ]);
  const stillUsed = new Set(used.flat());

  for (const url of urls) {
    if (stillUsed.has(url)) continue;
    const result = deleteFileFromDisk(url);
    if (!result.success) console.warn(`Failed to delete attachment file: ${result.error}`);
  }
};
exports.deleteUnreferencedFiles = deleteUnreferencedFiles;

/**
 * Hard-delete tasks and everything hanging off them.
 * Shared by single-task delete and project delete so the cascade can't drift.
 * @param {Array<{_id, attachments}>} tasks - task docs (need _id + attachments)
 */
exports.purgeTasks = async (tasks) => {
  if (!tasks?.length) return;

  const taskIds = tasks.map((t) => t._id);
  const byTask = { taskId: { $in: taskIds } };

  const subtasks = await SubtaskModel.find(byTask, { _id: 1, attachments: 1 }).lean();
  await deleteUnreferencedFiles(
    [...tasks, ...subtasks].flatMap((d) => (d.attachments || []).map((a) => a.url)),
    { taskIds, subtaskIds: subtasks.map((st) => st._id) }
  );

  const commentIds = (await TaskCommentModel.find(byTask, { _id: 1 }).lean()).map((c) => c._id);

  await Promise.all([
    deleteManyActivities(byTask),
    deleteManyNotifications(byTask),
    SubtaskModel.deleteMany(byTask),
    TaskInbox.deleteMany(byTask),
    TaskConnectionModel.deleteMany({
      $or: [{ sourceTaskId: { $in: taskIds } }, { targetTaskId: { $in: taskIds } }],
    }),
    TaskCommentModel.deleteMany(byTask),
    TaskViewModel.deleteMany(byTask),
    commentIds.length ? removeAllReactionsForComments(commentIds) : null,
  ]);

  await TaskModel.deleteMany({ _id: { $in: taskIds } });
};
