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

    // Validate arrays if provided
    if (personalDetails && !Array.isArray(personalDetails)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "personalDetails must be an array",
      });
    }

    if (attachments && !Array.isArray(attachments)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "attachments must be an array",
      });
    }

    if (projects && !Array.isArray(projects)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "projects must be an array",
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
      // Update existing client by appending new data to arrays
      const updateOperations = {
        $set: { updatedAt: new Date() },
      };

      // Append new personalDetails to existing array
      if (personalDetails && personalDetails.length > 0) {
        updateOperations.$push = {
          ...updateOperations.$push,
          personalDetails: { $each: personalDetails },
        };
      }

      // Append new attachments to existing array
      if (attachments && attachments.length > 0) {
        updateOperations.$push = {
          ...updateOperations.$push,
          attachments: { $each: attachments },
        };
      }

      // Append new projects to existing array
      if (projects && projects.length > 0) {
        updateOperations.$push = {
          ...updateOperations.$push,
          projects: { $each: projects },
        };
      }

      const updatedClient = await updateClient({ tabId }, updateOperations);

      return generateResponse(
        updatedClient,
        `Client updated successfully. Added ${
          personalDetails?.length || 0
        } personal details, ${attachments?.length || 0} attachments, and ${
          projects?.length || 0
        } projects.`,
        res,
        STATUS_CODES.SUCCESS
      );
    } else {
      // Create new client with provided arrays
      const newClientData = {
        tabId,
        personalDetails: personalDetails || [],
        attachments: attachments || [],
        projects: projects || [],
      };

      const newClient = await createClient(newClientData);

      return generateResponse(
        newClient,
        `Client created successfully with ${
          personalDetails?.length || 0
        } personal details, ${attachments?.length || 0} attachments, and ${
          projects?.length || 0
        } projects.`,
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
