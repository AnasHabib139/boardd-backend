const {
  findClient,
  updateClient,
  createClient,
} = require("../models/clientModel");
const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findChannelTab } = require("../models/channelTabsModel");

exports.createOrUpdateClient = async (req, res, next) => {
  try {
    const { tabId, personalDetails, attachments, projects } = parseBody(
      req.body
    );

    // Validate that at least one optional field is provided
    if (!personalDetails && !attachments && !projects) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "At least one field (personalDetails, attachments, or projects) is required",
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

    // Check if client already exists for this tab
    const existingClient = await findClient({ tabId });

    if (existingClient) {
      // Update existing client by adding new data
      const updateOperations = {};

      if (personalDetails) {
        updateOperations.$push = {
          ...updateOperations.$push,
          personalDetails: personalDetails,
        };
      }

      if (attachments) {
        updateOperations.$push = {
          ...updateOperations.$push,
          attachments: attachments,
        };
      }

      if (projects) {
        updateOperations.$push = {
          ...updateOperations.$push,
          projects: projects,
        };
      }

      // Add updated timestamp
      updateOperations.$set = { updatedAt: new Date() };

      const updatedClient = await updateClient({ tabId }, updateOperations);

      return generateResponse(
        updatedClient,
        "Client updated successfully",
        res,
        STATUS_CODES.SUCCESS
      );
    } else {
      // Create new client
      const newClientData = {
        tabId,
        personalDetails: personalDetails ? [personalDetails] : [],
        attachments: attachments ? [attachments] : [],
        projects: projects ? [projects] : [],
      };

      const newClient = await createClient(newClientData);

      return generateResponse(
        newClient,
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
