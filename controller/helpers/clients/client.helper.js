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

/**
 * Create payment method added activity
 */
exports.createPaymentMethodAddedActivity = async ({
  tabId,
  userId,
  userName,
  client,
  paymentMethod,
}) => {
  const cardBrand = paymentMethod?.card?.brand || "card";
  const cardLast4 = paymentMethod?.card?.last4 || "****";
  const cardInfo = `${cardBrand} ending in ${cardLast4}`;

  const paymentMethodMessage = {
    forCreator: `You added payment method (${cardInfo})`,
    forOthers: `${userName} added payment method (${cardInfo})`,
  };

  return createActivity({
    tabId,
    clientId: client._id,
    userId,
    actionType: ACTION_TYPE.CLIENT_PAYMENT_ADDED,
    field: "stripe.paymentMethods",
    newValue: {
      paymentMethodId: paymentMethod?.paymentMethodId,
      brand: paymentMethod?.card?.brand,
      last4: paymentMethod?.card?.last4,
    },
    timestamp: new Date(),
    message: paymentMethodMessage,
  });
};

/**
 * Create payment method removed activity
 */
exports.createPaymentMethodRemovedActivity = async ({
  tabId,
  userId,
  userName,
  client,
  paymentMethod,
}) => {
  const cardBrand = paymentMethod?.card?.brand || "card";
  const cardLast4 = paymentMethod?.card?.last4 || "****";
  const cardInfo = `${cardBrand} ending in ${cardLast4}`;

  const paymentMethodMessage = {
    forCreator: `You removed payment method (${cardInfo})`,
    forOthers: `${userName} removed payment method (${cardInfo})`,
  };

  return createActivity({
    tabId,
    clientId: client._id,
    userId,
    actionType: ACTION_TYPE.CLIENT_PAYMENT_REMOVED,
    field: "stripe.paymentMethods",
    newValue: {
      paymentMethodId: paymentMethod?.paymentMethodId,
      brand: paymentMethod?.card?.brand,
      last4: paymentMethod?.card?.last4,
    },
    timestamp: new Date(),
    message: paymentMethodMessage,
  });
};

/**
 * Create payment method set default activity
 */
exports.createPaymentMethodSetDefaultActivity = async ({
  tabId,
  userId,
  userName,
  client,
  paymentMethod,
}) => {
  const cardBrand = paymentMethod?.card?.brand || "card";
  const cardLast4 = paymentMethod?.card?.last4 || "****";
  const cardInfo = `${cardBrand} ending in ${cardLast4}`;

  const paymentMethodMessage = {
    forCreator: `You set ${cardInfo} as default payment method`,
    forOthers: `${userName} set ${cardInfo} as default payment method`,
  };

  return createActivity({
    tabId,
    clientId: client._id,
    userId,
    actionType: ACTION_TYPE.CLIENT_PAYMENT_SET_DEFAULT,
    field: "stripe.defaultPaymentMethod",
    newValue: {
      paymentMethodId: paymentMethod?.paymentMethodId,
      brand: paymentMethod?.card?.brand,
      last4: paymentMethod?.card?.last4,
    },
    timestamp: new Date(),
    message: paymentMethodMessage,
  });
};
