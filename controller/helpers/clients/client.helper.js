const { createActivity } = require("../../../models/activityModel");
const { ACTION_TYPE } = require("../../../utils/constants");

/**
 * Create client creation activity
 */
exports.createClientCreationActivity = async ({
  tabId,
  userId,
  userName,
  client,
}) => {
  const createClientMessage = {
    forCreator: "You created a new client profile",
    forOthers: `${userName} created a new client profile`,
  };

  return createActivity({
    tabId,
    clientId: client._id,
    userId,
    actionType: ACTION_TYPE.CREATE_CLIENT,
    timestamp: new Date(),
    message: createClientMessage,
  });
};

/**
 * Create personal details activity
 */
exports.createPersonalDetailsActivity = async ({
  tabId,
  userId,
  userName,
  client,
  personalDetails,
  isUpdate = false,
}) => {
  const actionType = isUpdate
    ? ACTION_TYPE.UPDATE_CLIENT_PERSONAL_DETAILS
    : ACTION_TYPE.ADD_CLIENT_PERSONAL_DETAILS;

  const action = isUpdate ? "updated" : "added";
  const clientName = personalDetails?.name || "client";

  const personalDetailsMessage = {
    forCreator: `You ${action} personal details for ${clientName}`,
    forOthers: `${userName} ${action} personal details for ${clientName}`,
  };

  return createActivity({
    tabId,
    clientId: client._id,
    userId,
    actionType,
    field: "personalDetails",
    newValue: personalDetails,
    timestamp: new Date(),
    message: personalDetailsMessage,
  });
};

/**
 * Create attachment activity
 */
exports.createAttachmentActivity = async ({
  tabId,
  userId,
  userName,
  client,
  attachments, // This will be an array of attachments
}) => {
  const count = Array.isArray(attachments) ? attachments.length : 1;
  const attachmentMessage = {
    forCreator: `You uploaded ${count} attachment${count > 1 ? "s" : ""}`,
    forOthers: `${userName} uploaded ${count} attachment${
      count > 1 ? "s" : ""
    }`,
  };

  return createActivity({
    tabId,
    clientId: client._id,
    userId,
    actionType: ACTION_TYPE.ADD_CLIENT_ATTACHMENT,
    field: "attachments",
    newValue: attachments, // Array of attachments
    timestamp: new Date(),
    message: attachmentMessage,
  });
};

/**
 * Create project activity
 */
exports.createProjectActivity = async ({
  tabId,
  userId,
  userName,
  client,
  projects,
  isUpdate = false,
}) => {
  const actionType = isUpdate
    ? ACTION_TYPE.UPDATE_CLIENT_PROJECT
    : ACTION_TYPE.ADD_CLIENT_PROJECT;

  const action = isUpdate ? "updated" : "added";
  const projectTitle = projects?.title || "project";

  const projectMessage = {
    forCreator: `You ${action} project "${projectTitle}"`,
    forOthers: `${userName} ${action} project "${projectTitle}"`,
  };

  return createActivity({
    tabId,
    clientId: client._id,
    userId,
    actionType,
    field: "projects",
    newValue: projects,
    timestamp: new Date(),
    message: projectMessage,
  });
};
