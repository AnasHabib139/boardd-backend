const {
  findClient,
  updateClient,
  createClient,
} = require("../models/clientModel");
const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findChannelTab } = require("../models/channelTabsModel");
const { findUser } = require("../models/userModel");
const { createActivity } = require("../models/activityModel");
const {
  createClientCreationActivity,
  createClientDetailsActivity,
  createProjectActivity,
} = require("./helpers/clients/client.helper");

// Helper to simplify client response (exclude stripe, internal fields)
const simplifyClientResponse = (client) => {
  const { stripe, __v, ...rest } = client.toObject ? client.toObject() : client;
  return rest;
};

exports.createOrUpdateClient = async (req, res, next) => {
  try {
    const { tabId, clientDetails, projects } = parseBody(req.body);

    // Validate that at least one optional field is provided
    if (!clientDetails && !projects) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "At least one field (clientDetails or projects) is required",
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

      if (clientDetails) {
        updateOperations.$push = {
          ...updateOperations.$push,
          clientDetails: clientDetails,
        };

        // Create activity for client details update
        const clientDetailsActivity = await createClientDetailsActivity({
          tabId,
          userId,
          userName,
          client: existingClient,
          clientDetails,
          isUpdate: true,
        });
        activities.push(clientDetailsActivity);
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
        { client: simplifyClientResponse(client), activities },
        "Client updated successfully",
        res,
        STATUS_CODES.SUCCESS
      );
    } else {
      // Create new client
      const newClientData = {
        tabId,
        clientDetails: clientDetails ? [clientDetails] : [],
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
      if (clientDetails) {
        const clientDetailsActivity = await createClientDetailsActivity({
          tabId,
          userId,
          userName,
          client,
          clientDetails,
          isUpdate: false,
        });
        activities.push(clientDetailsActivity);
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
        { client: simplifyClientResponse(client), activities },
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
 * Update specific client data (client details OR projects)
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
    if (!["clientDetails", "projects"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "type must be either 'clientDetails' or 'projects'",
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

    if (type === "clientDetails") {
      // Find and update specific client details
      const clientDetailsIndex = client.clientDetails.findIndex(
        (cd) => cd._id.toString() === id
      );

      if (clientDetailsIndex === -1) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Client details not found",
        });
      }

      // Update the specific client details
      updatedClient = await updateClient(
        { tabId },
        {
          $set: {
            [`clientDetails.${clientDetailsIndex}`]: {
              ...data,
              _id: client.clientDetails[clientDetailsIndex]._id, // Keep the original ID
            },
            updatedAt: new Date(),
          },
        }
      );

      // Create activity for client details update
      const clientDetailsActivity = await createClientDetailsActivity({
        tabId,
        userId,
        userName,
        client: updatedClient,
        clientDetails: data,
        isUpdate: true,
      });
      activities.push(clientDetailsActivity);
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
      { client: simplifyClientResponse(updatedClient), activities },
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
 * Delete specific client data (client details or projects)
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
    if (!["clientDetails", "projects"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "type must be 'clientDetails' or 'projects'",
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

    if (type === "clientDetails") {
      // Check if client details exists
      const clientDetailsExists = client.clientDetails.some(
        (cd) => cd._id.toString() === id
      );

      if (!clientDetailsExists) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Client details not found",
        });
      }

      // Remove the specific client details
      updatedClient = await updateClient(
        { tabId },
        {
          $pull: { clientDetails: { _id: id } },
          $set: { updatedAt: new Date() },
        }
      );

      // Create activity for client details deletion
      const deleteActivity = await createActivity({
        tabId,
        clientId: client._id,
        userId,
        actionType: ACTION_TYPE.DELETE_CLIENT_DETAILS,
        timestamp: new Date(),
        message: {
          forCreator: `You deleted client details`,
          forOthers: `${userName} deleted client details`,
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
    }

    return generateResponse(
      { client: simplifyClientResponse(updatedClient), activities },
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
