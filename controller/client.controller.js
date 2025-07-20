const {
  findClient,
  updateClient,
  createClient,
} = require("../models/clientModel");
const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findChannelTab } = require("../models/channelTabsModel");
const { findUser } = require("../models/userModel");
const {
  createClientCreationActivity,
  createPersonalDetailsActivity,
  createAttachmentActivity,
  createProjectActivity,
} = require("./helpers/clients/client.helper");

exports.createOrUpdateClient = async (req, res, next) => {
  try {
    const { tabId, personalDetails, attachment, projects } = parseBody(
      req.body
    );

    // Validate that at least one optional field is provided
    if (!personalDetails && !attachment && !projects) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "At least one field (personalDetails, attachment, or projects) is required",
      });
    }

    // Find and validate tab
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    // Check if user is member of the tab
    const userId = req.user.id;
    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Get user info for activity messages
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const userName = user.name || user.email;

    // Check if client already exists for this tab
    const existingClient = await findClient({ tabId });

    let client;
    let activities = [];

    if (existingClient) {
      // Update existing client by adding new data
      const updateOperations = {};

      if (personalDetails) {
        updateOperations.$push = {
          ...updateOperations.$push,
          personalDetails: personalDetails,
        };

        // Create activity for personal details update
        const personalDetailsActivity = await createPersonalDetailsActivity({
          tabId,
          userId,
          userName,
          client: existingClient,
          personalDetails,
          isUpdate: true,
        });
        activities.push(personalDetailsActivity);
      }

      if (attachment) {
        updateOperations.$push = {
          ...updateOperations.$push,
          attachments: attachment, // Push single attachment to array
        };

        // Create activity for attachment upload
        const attachmentActivity = await createAttachmentActivity({
          tabId,
          userId,
          userName,
          client: existingClient,
          attachments: attachment, // Pass single attachment
        });
        activities.push(attachmentActivity);
      }

      if (projects) {
        updateOperations.$push = {
          ...updateOperations.$push,
          projects: projects,
        };

        // Create activity for project addition/update
        const projectActivity = await createProjectActivity({
          tabId,
          userId,
          userName,
          client: existingClient,
          projects,
          isUpdate: true,
        });
        activities.push(projectActivity);
      }

      // Add updated timestamp
      updateOperations.$set = { updatedAt: new Date() };

      client = await updateClient({ tabId }, updateOperations);

      return generateResponse(
        { client, activities },
        "Client updated successfully",
        res,
        STATUS_CODES.SUCCESS
      );
    } else {
      // Create new client
      const newClientData = {
        tabId,
        personalDetails: personalDetails ? [personalDetails] : [],
        attachments: attachment ? [attachment] : [], // Create array with single attachment
        projects: projects ? [projects] : [],
      };

      client = await createClient(newClientData);

      // Create client creation activity
      const clientCreationActivity = await createClientCreationActivity({
        tabId,
        userId,
        userName,
        client,
      });
      activities.push(clientCreationActivity);

      // Create activities for initial data
      if (personalDetails) {
        const personalDetailsActivity = await createPersonalDetailsActivity({
          tabId,
          userId,
          userName,
          client,
          personalDetails,
          isUpdate: false,
        });
        activities.push(personalDetailsActivity);
      }

      if (attachment) {
        const attachmentActivity = await createAttachmentActivity({
          tabId,
          userId,
          userName,
          client,
          attachments: attachment, // Pass single attachment
        });
        activities.push(attachmentActivity);
      }

      if (projects) {
        const projectActivity = await createProjectActivity({
          tabId,
          userId,
          userName,
          client,
          projects,
          isUpdate: false,
        });
        activities.push(projectActivity);
      }

      return generateResponse(
        { client, activities },
        "Client created successfully",
        res,
        STATUS_CODES.CREATED
      );
    }
  } catch (error) {
    console.error("Error in createOrUpdateClient:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to create or update client",
    });
  }
};

//get client for a tab

exports.getClientForTab = async (req, res, next) => {
  try {
    const tabId = req.params.tabId;
    const client = await findClient({ tabId });
    return generateResponse(
      client,
      "Client fetched successfully",
      res,
      STATUS_CODES.OK
    );
  } catch (error) {
    next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to get client",
    });
  }
};
