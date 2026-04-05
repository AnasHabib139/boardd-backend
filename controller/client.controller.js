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

/**
 * Resolve a client by tabId or clientId, and verify access.
 * Returns { client, resolvedTabId (may be null), isTabScoped } or calls next() with error and returns null.
 */
const resolveClientAndAccess = async (id, userId, user, next) => {
  // Try tab-scoped first
  const tab = await findChannelTab({ _id: id });
  if (tab) {
    if (!tab.members?.includes(userId)) {
      next({ statusCode: STATUS_CODES.FORBIDDEN, message: "You are not a member of this tab" });
      return null;
    }
    const client = await findClient({ tabId: id });
    return { client, resolvedTabId: id, isTabScoped: true };
  }

  // Fallback: treat id as clientId
  const client = await findClient({ _id: id });
  if (!client) {
    next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Client not found" });
    return null;
  }
  if (client.companyId?.toString() !== user.companyId?.toString()) {
    next({ statusCode: STATUS_CODES.FORBIDDEN, message: "Access denied" });
    return null;
  }
  return { client, resolvedTabId: null, isTabScoped: false };
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

    const userId = req.user.id;

    // Get user info first (needed for companyId fallback + activity messages)
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const userName = user.name || user.email;
    let companyId;

    if (tabId) {
      // Tab-scoped path: validate tab and membership
      const tab = await findChannelTab({ _id: tabId });
      if (!tab) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab not found",
        });
      }

      if (!tab?.members?.includes(userId)) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You are not a member of this tab",
        });
      }

      companyId = tab.companyId;
    } else {
      // Company-scoped path: get companyId from user document
      companyId = user.companyId;
      if (!companyId) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "Company information not found",
        });
      }
    }

    // Query key: tab-scoped vs company-scoped (no tabId)
    const clientQuery = tabId
      ? { tabId }
      : { companyId, tabId: { $exists: false } };

    // Check if client already exists
    const existingClient = await findClient(clientQuery);

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

      client = await updateClient(clientQuery, updateOperations);

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
        companyId, // Link to company for payment processing
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
    const { tabId: paramId } = req.params;
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

    const userId = req.user.id;
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });
    }

    const resolved = await resolveClientAndAccess(paramId, userId, user, next);
    if (!resolved) return;

    const { client, resolvedTabId } = resolved;
    const userName = user.name || user.email;
    const clientQuery = resolvedTabId ? { tabId: resolvedTabId } : { _id: client._id };

    if (!client) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Client not found" });
    }

    // Update based on type
    let updatedClient;
    let activities = [];

    if (type === "clientDetails") {
      const clientDetailsIndex = client.clientDetails.findIndex(
        (cd) => cd._id.toString() === id
      );

      if (clientDetailsIndex === -1) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Client details not found" });
      }

      updatedClient = await updateClient(clientQuery, {
        $set: {
          [`clientDetails.${clientDetailsIndex}`]: {
            ...data,
            _id: client.clientDetails[clientDetailsIndex]._id,
          },
          updatedAt: new Date(),
        },
      });

      const clientDetailsActivity = await createClientDetailsActivity({
        tabId: resolvedTabId,
        userId,
        userName,
        client: updatedClient,
        clientDetails: data,
        isUpdate: true,
      });
      activities.push(clientDetailsActivity);
    } else if (type === "projects") {
      const projectIndex = client.projects.findIndex(
        (p) => p._id.toString() === id
      );

      if (projectIndex === -1) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Project not found" });
      }

      updatedClient = await updateClient(clientQuery, {
        $set: {
          [`projects.${projectIndex}`]: {
            ...data,
            _id: client.projects[projectIndex]._id,
          },
          updatedAt: new Date(),
        },
      });

      const projectActivity = await createProjectActivity({
        tabId: resolvedTabId,
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
    const { tabId: paramId } = req.params;
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

    const userId = req.user.id;
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });
    }

    const resolved = await resolveClientAndAccess(paramId, userId, user, next);
    if (!resolved) return;

    const { client, resolvedTabId } = resolved;
    const userName = user.name || user.email;
    const clientQuery = resolvedTabId ? { tabId: resolvedTabId } : { _id: client._id };

    // Delete based on type
    let updatedClient;
    let activities = [];

    if (type === "clientDetails") {
      const clientDetailsExists = client.clientDetails.some(
        (cd) => cd._id.toString() === id
      );

      if (!clientDetailsExists) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Client details not found" });
      }

      updatedClient = await updateClient(clientQuery, {
        $pull: { clientDetails: { _id: id } },
        $set: { updatedAt: new Date() },
      });

      const deleteActivity = await createActivity({
        tabId: resolvedTabId,
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
      const projectExists = client.projects.some(
        (p) => p._id.toString() === id
      );

      if (!projectExists) {
        return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Project not found" });
      }

      updatedClient = await updateClient(clientQuery, {
        $pull: { projects: { _id: id } },
        $set: { updatedAt: new Date() },
      });

      const deleteActivity = await createActivity({
        tabId: resolvedTabId,
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

exports.getClientForTab = async (req, res, next) => {
  try {
    const { tabId: paramId } = req.params;
    const userId = req.user.id;
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });
    }

    const resolved = await resolveClientAndAccess(paramId, userId, user, next);
    if (!resolved) return;

    return generateResponse(resolved.client, "Client fetched successfully", res, STATUS_CODES.SUCCESS);
  } catch (error) {
    next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to get client",
    });
  }
};

/**
 * Get revenue stats for client tab (for graph display)
 * Returns monthly totals, largest payments, and all-time total
 */
exports.getRevenueStats = async (req, res, next) => {
  try {
    const { tabId: paramId } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const userId = req.user.id;
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "User not found" });
    }

    const resolved = await resolveClientAndAccess(paramId, userId, user, next);
    if (!resolved) return;

    const {
      getRevenueStatsByTab,
      getTotalRevenueByTab,
      getRevenueStatsByClient,
      getTotalRevenueByClient,
    } = require("../models/invoiceModel");

    const [monthlyData, total] = resolved.isTabScoped
      ? await Promise.all([getRevenueStatsByTab(paramId, year), getTotalRevenueByTab(paramId)])
      : await Promise.all([getRevenueStatsByClient(resolved.client._id, year), getTotalRevenueByClient(resolved.client._id)]);

    // Month names for display
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    // Build full 12-month array with zeros for missing months
    const monthly = monthNames.map((month, index) => {
      const monthNumber = index + 1;
      const found = monthlyData.find((m) => m._id === monthNumber);
      return {
        month,
        totalAmount: found ? found.totalAmount : 0,
        largestPayment: found ? found.largestPayment : 0,
      };
    });

    return generateResponse(
      {
        total,
        currency: "usd",
        year,
        monthly,
      },
      "Revenue stats retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getRevenueStats:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to get revenue stats",
    });
  }
};
