const { createActivity } = require("../../../models/activityModel");
const { createNotification } = require("../../../models/notificationModel");
const { findManyUsers } = require("../../../models/userModel");
const { generateActivityMessage } = require("../../../utils");
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
