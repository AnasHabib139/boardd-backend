"use strict";

const { generateResponse, parseBody } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");
const stripeService = require("../services/stripe.service");
const { stripe } = require("../lib/stripeClient");
const config = require("../config");

/**
 * Create Stripe Custom Connect account
 * POST /api/payments/connect/accounts
 */
exports.createAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const accountData = req.validatedBody;

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    const companyId = user.companyId;

    console.log(`Creating Stripe Connect account for company: ${companyId}`);

    // Capture TOS acceptance metadata
    const tosData = {
      date: Math.floor(Date.now() / 1000),
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    // Create account via service
    const result = await stripeService.createConnectAccount(
      companyId,
      accountData,
      tosData
    );

    if (result.alreadyExists) {
      return generateResponse(
        {
          accountId: result.accountId,
          message: "Stripe account already exists for this company",
        },
        "Stripe account already configured",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    return generateResponse(
      {
        accountId: result.accountId,
        capabilities: result.capabilities,
        requirements: result.requirements,
        onboardingComplete: result.account.onboardingComplete,
        chargesEnabled: result.account.chargesEnabled,
        payoutsEnabled: result.account.payoutsEnabled,
      },
      "Stripe Connect account created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createAccount controller:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to create Stripe Connect account",
    });
  }
};

/**
 * Update Stripe Connect account
 * PUT /api/payments/connect/accounts/:companyId
 */
exports.updateAccount = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.id;
    const updates = req.validatedBody;

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security: Ensure user can only update their own company's account
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to update this account",
      });
    }

    console.log(`Updating Stripe Connect account for company: ${companyId}`);

    // If TOS acceptance is being updated, capture IP and timestamp
    if (updates.tosAcceptance) {
      updates.tosAcceptance = {
        date: updates.tosAcceptance.date || Math.floor(Date.now() / 1000),
        ip: updates.tosAcceptance.ip || req.ip || req.connection.remoteAddress,
      };
    }

    const result = await stripeService.updateConnectAccount(companyId, updates);

    return generateResponse(
      {
        accountId: result.account.stripeAccountId,
        updated: true,
      },
      "Stripe Connect account updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateAccount controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update Stripe Connect account",
    });
  }
};

/**
 * Add person (representative/owner) to account
 * POST /api/payments/connect/accounts/:companyId/persons
 */
exports.addPerson = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.id;
    const personData = req.validatedBody;

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to modify this account",
      });
    }

    console.log(`Adding person to Stripe account for company: ${companyId}`);

    const result = await stripeService.addAccountPerson(companyId, personData);

    return generateResponse(
      {
        personId: result.personId,
        verificationStatus: result.verificationStatus,
        person: {
          firstName: result.person.firstName,
          lastName: result.person.lastName,
          email: result.person.email,
          relationship: result.person.relationship,
        },
      },
      "Person added successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in addPerson controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to add person to account",
    });
  }
};

/**
 * Update existing person (representative/owner)
 * PUT /api/payments/connect/accounts/:companyId/persons/:personId
 */
exports.updatePerson = async (req, res, next) => {
  try {
    const { companyId, personId } = req.params;
    const userId = req.user.id;
    const updates = req.validatedBody;

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to modify this account",
      });
    }

    console.log(`Updating person ${personId} for company: ${companyId}`);

    const result = await stripeService.updateAccountPerson(companyId, personId, updates);

    return generateResponse(
      {
        personId: result.personId,
        verificationStatus: result.verificationStatus,
        updated: true,
      },
      "Person updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updatePerson controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account or person not found",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update person",
    });
  }
};

/**
 * Upload verification document for person
 * POST /api/payments/connect/accounts/:companyId/persons/:personId/documents
 */
exports.uploadPersonDocument = async (req, res, next) => {
  try {
    const { companyId, personId } = req.params;
    const { side } = req.body; // 'front' or 'back'
    const userId = req.user.id;

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to modify this account",
      });
    }

    if (!req.file) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Document file is required",
      });
    }

    if (!["front", "back"].includes(side)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Side must be 'front' or 'back'",
      });
    }

    console.log(`Uploading ${side} document for person: ${personId}`);

    const result = await stripeService.uploadPersonDocument(
      companyId,
      personId,
      req.file,
      side
    );

    return generateResponse(
      {
        fileId: result.fileId,
        side: result.side,
      },
      "Document uploaded successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in uploadPersonDocument controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to upload document",
    });
  }
};

/**
 * Get account onboarding status and requirements
 * GET /api/payments/connect/accounts/:companyId/status
 */
exports.getAccountStatus = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.id;

    console.log(`Fetching account status for company: ${companyId}`);

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to view this account",
      });
    }

    const result = await stripeService.getAccountStatus(companyId);

    return generateResponse(
      result,
      "Account status retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getAccountStatus controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company. Please complete onboarding first.",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch account status",
    });
  }
};

/**
 * Add external bank account for payouts
 * POST /api/payments/connect/accounts/:companyId/external-account
 */
exports.addExternalAccount = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.id;
    const bankData = req.validatedBody;

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to modify this account",
      });
    }

    console.log(`Adding external bank account for company: ${companyId}`);

    const result = await stripeService.addExternalAccount(companyId, bankData);

    return generateResponse(
      {
        bankAccountId: result.bankAccountId,
        bankAccount: result.bankAccount, // Masked account info
      },
      "Bank account added successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in addExternalAccount controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to add bank account",
    });
  }
};

/**
 * Handle Stripe webhooks
 * POST /api/payments/webhooks/stripe
 */
exports.handleWebhook = async (req, res, next) => {
  try {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = config.stripe.webhookSecret;

    if (!webhookSecret) {
      console.error("Webhook secret not configured");
      return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        error: "Webhook configuration error",
      });
    }

    // Verify webhook signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, // Raw body
        sig,
        webhookSecret
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        error: `Webhook Error: ${err.message}`,
      });
    }

    console.log(`Received webhook: ${event.type}, ID: ${event.id}`);

    // Handle different event types
    switch (event.type) {
      case "account.updated":
        await stripeService.syncAccountFromWebhook(event);
        console.log(`Processed account.updated for ${event.account || event.data.object.id}`);
        break;

      case "capability.updated":
        await stripeService.syncAccountFromWebhook(event);
        console.log(`Processed capability.updated for ${event.account}`);
        break;

      case "person.updated":
        console.log(`Person updated: ${event.data.object.id} for account ${event.account}`);
        // TODO: Implement person sync if needed
        break;

      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }

    // Acknowledge receipt
    res.json({ received: true });
  } catch (error) {
    console.error("Error handling webhook:", error);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      error: "Webhook processing error",
      message: error.message,
    });
  }
};
