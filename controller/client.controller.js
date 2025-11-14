const {
  findClient,
  updateClient,
  createClient,
} = require("../models/clientModel");
const { parseBody, generateResponse, deleteFileFromDisk } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findChannelTab } = require("../models/channelTabsModel");
const { findUser } = require("../models/userModel");
const { createActivity } = require("../models/activityModel");
const {
  createClientCreationActivity,
  createPersonalDetailsActivity,
  createAttachmentActivity,
  createProjectActivity,
} = require("./helpers/clients/client.helper");

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

      if (attachments && attachments.length > 0) {
        updateOperations.$push = {
          ...updateOperations.$push,
          attachments: { $each: attachments }, // Push array of attachments
        };

        // Create activity for attachments upload
        const attachmentActivity = await createAttachmentActivity({
          tabId,
          userId,
          userName,
          client: existingClient,
          attachments, // Pass array of attachments
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
        attachments: attachments || [], // Use attachments array directly
        projects: projects ? [projects] : [],
        companyId: tab.companyId, // Link to company for payment processing
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

      if (attachments && attachments.length > 0) {
        const attachmentActivity = await createAttachmentActivity({
          tabId,
          userId,
          userName,
          client,
          attachments, // Pass array of attachments
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

/**
 * Update specific client data (personal details OR projects)
 */
exports.updateClientData = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const { type, id, data } = parseBody(req.body);

    // Validate request structure
    if (!type || !id || !data) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "type, id, and data are required",
      });
    }

    // Validate type
    if (!["personalDetails", "projects"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "type must be either 'personalDetails' or 'projects'",
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

    // Find the client
    const client = await findClient({ tabId });
    if (!client) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Client not found",
      });
    }

    const userName = user.name || user.email;

    // Update based on type
    let updatedClient;
    let activities = [];

    if (type === "personalDetails") {
      // Find and update specific personal details
      const personalDetailsIndex = client.personalDetails.findIndex(
        (pd) => pd._id.toString() === id
      );

      if (personalDetailsIndex === -1) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Personal details not found",
        });
      }

      // Update the specific personal details
      updatedClient = await updateClient(
        { tabId },
        {
          $set: {
            [`personalDetails.${personalDetailsIndex}`]: {
              ...data,
              _id: client.personalDetails[personalDetailsIndex]._id, // Keep the original ID
            },
            updatedAt: new Date(),
          },
        }
      );

      // Create activity for personal details update
      const personalDetailsActivity = await createPersonalDetailsActivity({
        tabId,
        userId,
        userName,
        client: updatedClient,
        personalDetails: data,
        isUpdate: true,
      });
      activities.push(personalDetailsActivity);
    } else if (type === "projects") {
      // Find and update specific project
      const projectIndex = client.projects.findIndex(
        (p) => p._id.toString() === id
      );

      if (projectIndex === -1) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }

      // Update the specific project
      updatedClient = await updateClient(
        { tabId },
        {
          $set: {
            [`projects.${projectIndex}`]: {
              ...data,
              _id: client.projects[projectIndex]._id, // Keep the original ID
            },
            updatedAt: new Date(),
          },
        }
      );

      // Create activity for project update
      const projectActivity = await createProjectActivity({
        tabId,
        userId,
        userName,
        client: updatedClient,
        projects: data,
        isUpdate: true,
      });
      activities.push(projectActivity);
    }

    return generateResponse(
      { client: updatedClient, activities },
      `Client ${type} updated successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateClientData:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update client data",
    });
  }
};

/**
 * Delete specific client data (personal details, projects, or attachments)
 */
exports.deleteClientData = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const { type, id } = parseBody(req.body);

    // Validate request structure
    if (!type || !id) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "type and id are required",
      });
    }

    // Validate type
    if (!["personalDetails", "projects", "attachments"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "type must be 'personalDetails', 'projects', or 'attachments'",
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

    // Find the client
    const client = await findClient({ tabId });
    if (!client) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Client not found",
      });
    }

    const userName = user.name || user.email;

    // Delete based on type
    let updatedClient;
    let activities = [];

    if (type === "personalDetails") {
      // Check if personal details exists
      const personalDetailsExists = client.personalDetails.some(
        (pd) => pd._id.toString() === id
      );

      if (!personalDetailsExists) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Personal details not found",
        });
      }

      // Remove the specific personal details
      updatedClient = await updateClient(
        { tabId },
        {
          $pull: { personalDetails: { _id: id } },
          $set: { updatedAt: new Date() },
        }
      );

      // Create activity for personal details deletion
      const deleteActivity = await createActivity({
        tabId,
        clientId: client._id,
        userId,
        actionType: ACTION_TYPE.DELETE_CLIENT_PERSONAL_DETAILS,
        timestamp: new Date(),
        message: {
          forCreator: `You deleted client personal details`,
          forOthers: `${userName} deleted client personal details`,
        },
      });
      activities.push(deleteActivity);
    } else if (type === "projects") {
      // Check if project exists
      const projectExists = client.projects.some(
        (p) => p._id.toString() === id
      );

      if (!projectExists) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Project not found",
        });
      }

      // Remove the specific project
      updatedClient = await updateClient(
        { tabId },
        {
          $pull: { projects: { _id: id } },
          $set: { updatedAt: new Date() },
        }
      );

      // Create activity for project deletion
      const deleteActivity = await createActivity({
        tabId,
        clientId: client._id,
        userId,
        actionType: ACTION_TYPE.DELETE_CLIENT_PROJECT,
        timestamp: new Date(),
        message: {
          forCreator: `You deleted client project`,
          forOthers: `${userName} deleted client project`,
        },
      });
      activities.push(deleteActivity);
    } else if (type === "attachments") {
      // For attachments, id is the attachment string itself
      const attachmentExists = client.attachments.includes(id);

      if (!attachmentExists) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Attachment not found",
        });
      }

      // First, try to delete the file from disk
      const fileDeleteResult = deleteFileFromDisk(id);
      if (!fileDeleteResult.success) {
        console.warn(
          `Failed to delete file from disk: ${fileDeleteResult.error}. Proceeding with database removal.`
        );
        // Continue with database removal even if file deletion fails
        // This handles cases where file might already be deleted or path changed
      }

      // Remove the specific attachment from database
      updatedClient = await updateClient(
        { tabId },
        {
          $pull: { attachments: id },
          $set: { updatedAt: new Date() },
        }
      );

      // Create activity for attachment deletion
      const deleteActivity = await createActivity({
        tabId,
        clientId: client._id,
        userId,
        actionType: ACTION_TYPE.DELETE_CLIENT_ATTACHMENT,
        timestamp: new Date(),
        message: {
          forCreator: `You removed client attachment`,
          forOthers: `${userName} removed client attachment`,
        },
      });
      activities.push(deleteActivity);
    }

    return generateResponse(
      { client: updatedClient, activities },
      `Client ${type} deleted successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteClientData:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to delete client data",
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
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to get client",
    });
  }
};
