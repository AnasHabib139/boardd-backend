"use strict";

const { generateResponse, parseBody } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");
const stripeService = require("../services/stripe.service");
const {
  findClient,
  updateClientStripeCustomer,
  addPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
} = require("../../models/clientModel");
const { findChannelTab } = require("../../models/channelTabsModel");
const { findUser } = require("../../models/userModel");
const { findAccountByCompany } = require("../models/PaymentsStripeAccount");
const {
  createPaymentMethodAddedActivity,
  createPaymentMethodRemovedActivity,
  createPaymentMethodSetDefaultActivity,
} = require("../../controller/helpers/clients/client.helper");

/**
 * Helper function to validate tab access
 */
async function validateTabAccess(tabId, userId) {
  // Find and validate tab
  const tab = await findChannelTab({ _id: tabId });
  if (!tab) {
    throw new Error("TAB_NOT_FOUND");
  }

  // Check if user is member of the tab
  if (!tab?.members?.includes(userId)) {
    throw new Error("FORBIDDEN");
  }

  return tab;
}

/**
 * Helper function to get client and company
 */
async function getClientAndCompany(tabId) {
  const client = await findClient({ tabId });
  if (!client) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  // Auto-fix: If client doesn't have companyId, get it from tab
  if (!client.companyId) {
    const tab = await findChannelTab({ _id: tabId });
    if (!tab || !tab.companyId) {
      throw new Error("CLIENT_NO_COMPANY");
    }

    // Update client with companyId from tab
    const { updateClient } = require("../../models/clientModel");
    const updatedClient = await updateClient(
      { _id: client._id },
      { companyId: tab.companyId }
    );

    console.log(`Auto-fixed: Set companyId for client ${client._id} from tab ${tabId}`);
    return updatedClient;
  }

  return client;
}

/**
 * Create SetupIntent for collecting payment method
 * POST /api/payments/clients/:tabId/payment/setup-intent
 * Body: { name, email, phone } (optional, for creating customer if doesn't exist)
 */
exports.createClientSetupIntent = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;
    const { name, email, phone, paymentMethodTypes } = parseBody(req.body);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client and company
    const client = await getClientAndCompany(tabId);
    const companyId = client.companyId.toString();

    let customerId = client.stripe?.customerId;

    // If no customer exists, create one
    if (!customerId) {
      console.log("No Stripe customer exists for client, creating one...");

      // Get customer info from personal details or request body
      const personalDetails = client.personalDetails?.[0];
      const customerData = {
        name: name || personalDetails?.name,
        email: email || personalDetails?.email,
        phone: phone || (personalDetails?.phone
          ? `${personalDetails.phone.countryCode}${personalDetails.phone.number}`
          : undefined),
      };

      if (!customerData.name || !customerData.email) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message:
            "Customer name and email are required. Provide them in request body or add personal details first.",
        });
      }

      // Create customer via Stripe service
      const customerResult = await stripeService.createClientCustomer(
        companyId,
        customerData
      );

      customerId = customerResult.customerId;

      // Update client with customer ID
      await updateClientStripeCustomer(client._id, customerId);

      console.log(`Stripe customer created: ${customerId}`);
    }

    // Create SetupIntent
    const result = await stripeService.createClientSetupIntent(
      companyId,
      customerId,
      paymentMethodTypes || ['card', 'us_bank_account'] // Default to both card and ACH
    );

    // Get connected account ID for frontend use
    const accountRecord = await findAccountByCompany(companyId);

    return generateResponse(
      {
        clientSecret: result.clientSecret,
        setupIntentId: result.setupIntentId,
        customerId: customerId,
        connectedAccountId: accountRecord?.stripeAccountId,
      },
      "SetupIntent created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createClientSetupIntent controller:", error);

    if (error.message === "TAB_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    if (error.message === "FORBIDDEN") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    if (error.message === "CLIENT_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Client not found for this tab. Please create client first.",
      });
    }

    if (error.message === "CLIENT_NO_COMPANY") {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Client has no associated company",
      });
    }

    if (error.message.includes("not verified") || error.message.includes("pending requirements")) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: error.message,
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to create SetupIntent",
    });
  }
};

/**
 * Save payment method after successful SetupIntent
 * POST /api/payments/clients/:tabId/payment/methods
 * Body: { setupIntentId }
 */
exports.savePaymentMethod = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;
    const { setupIntentId } = parseBody(req.body);

    if (!setupIntentId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "setupIntentId is required",
      });
    }

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client and company
    const client = await getClientAndCompany(tabId);
    const companyId = client.companyId.toString();

    // Retrieve payment method details from Stripe
    const result = await stripeService.retrievePaymentMethodDetails(
      companyId,
      setupIntentId
    );

    // Check if this payment method already exists
    const existingPaymentMethod = client.stripe?.paymentMethods?.find(
      (pm) => pm.paymentMethodId === result.paymentMethod.paymentMethodId
    );

    if (existingPaymentMethod) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "This payment method is already saved",
      });
    }

    // Prepare payment method data for database
    const paymentMethodData = {
      ...result.paymentMethod,
      isDefault: !client.stripe?.paymentMethods?.length, // First card is default
      addedBy: userId,
      addedAt: new Date(),
    };

    // Add payment method to client
    const updatedClient = await addPaymentMethod(
      client._id,
      paymentMethodData
    );

    // Get user info for activity message
    const user = await findUser({ _id: userId });
    const userName = user?.name || user?.email || "User";

    // Create activity log for payment method addition
    await createPaymentMethodAddedActivity({
      tabId,
      userId,
      userName,
      client: updatedClient,
      paymentMethod: paymentMethodData,
    });

    return generateResponse(
      {
        paymentMethod: paymentMethodData,
        isDefault: paymentMethodData.isDefault,
      },
      "Payment method saved successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in savePaymentMethod controller:", error);

    if (error.message === "TAB_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    if (error.message === "FORBIDDEN") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    if (error.message === "CLIENT_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Client not found for this tab",
      });
    }

    if (error.message.includes("SetupIntent has not succeeded")) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.message,
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to save payment method",
    });
  }
};

/**
 * List all payment methods for client
 * GET /api/payments/clients/:tabId/payment/methods
 */
exports.listClientPaymentMethods = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client
    const client = await getClientAndCompany(tabId);

    const paymentMethods = client.stripe?.paymentMethods || [];

    return generateResponse(
      {
        paymentMethods: paymentMethods,
        count: paymentMethods.length,
        defaultPaymentMethod: client.stripe?.defaultPaymentMethod || null,
      },
      "Payment methods retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in listClientPaymentMethods controller:", error);

    if (error.message === "TAB_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    if (error.message === "FORBIDDEN") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    if (error.message === "CLIENT_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Client not found for this tab",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to retrieve payment methods",
    });
  }
};

/**
 * Remove payment method from client
 * DELETE /api/payments/clients/:tabId/payment/methods/:paymentMethodId
 */
exports.removePaymentMethod = async (req, res, next) => {
  try {
    const { tabId, paymentMethodId } = req.params;
    const userId = req.user.id;

    if (!paymentMethodId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "paymentMethodId is required",
      });
    }

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client and company
    const client = await getClientAndCompany(tabId);
    const companyId = client.companyId.toString();

    // Check if payment method exists
    const paymentMethod = client.stripe?.paymentMethods?.find(
      (pm) => pm.paymentMethodId === paymentMethodId
    );

    if (!paymentMethod) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Payment method not found",
      });
    }

    // Detach from Stripe
    await stripeService.detachPaymentMethod(companyId, paymentMethodId);

    // Remove from database
    await removePaymentMethod(client._id, paymentMethodId);

    // Get user info for activity message
    const user = await findUser({ _id: userId });
    const userName = user?.name || user?.email || "User";

    // Create activity log for payment method removal
    await createPaymentMethodRemovedActivity({
      tabId,
      userId,
      userName,
      client: client,
      paymentMethod: paymentMethod,
    });

    return generateResponse(
      {
        paymentMethodId: paymentMethodId,
        removed: true,
      },
      "Payment method removed successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in removePaymentMethod controller:", error);

    if (error.message === "TAB_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    if (error.message === "FORBIDDEN") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    if (error.message === "CLIENT_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Client not found for this tab",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to remove payment method",
    });
  }
};

/**
 * Set default payment method for client
 * POST /api/payments/clients/:tabId/payment/methods/:paymentMethodId/set-default
 */
exports.setDefaultPaymentMethod = async (req, res, next) => {
  try {
    const { tabId, paymentMethodId } = req.params;
    const userId = req.user.id;

    if (!paymentMethodId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "paymentMethodId is required",
      });
    }

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client
    const client = await getClientAndCompany(tabId);

    // Check if payment method exists
    const paymentMethod = client.stripe?.paymentMethods?.find(
      (pm) => pm.paymentMethodId === paymentMethodId
    );

    if (!paymentMethod) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Payment method not found",
      });
    }

    // Set as default in database
    await setDefaultPaymentMethod(client._id, paymentMethodId);

    // Get user info for activity message
    const user = await findUser({ _id: userId });
    const userName = user?.name || user?.email || "User";

    // Create activity log for default payment method change
    await createPaymentMethodSetDefaultActivity({
      tabId,
      userId,
      userName,
      client: client,
      paymentMethod: paymentMethod,
    });

    return generateResponse(
      {
        paymentMethodId: paymentMethodId,
        isDefault: true,
      },
      "Default payment method updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in setDefaultPaymentMethod controller:", error);

    if (error.message === "TAB_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    if (error.message === "FORBIDDEN") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    if (error.message === "CLIENT_NOT_FOUND") {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Client not found for this tab",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to set default payment method",
    });
  }
};
