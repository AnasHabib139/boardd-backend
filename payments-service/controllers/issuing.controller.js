"use strict";

const { generateResponse } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");
const issuingService = require("../services/issuing.service");
const {
  findAccountByCompany,
  updateAccount,
  CAPABILITY_STATUSES
} = require("../models/PaymentsStripeAccount");
const {
  findCardholderByCompany,
  createCardholder: createCardholderInDB
} = require("../../models/paymentsCardholderModel");
const {
  findCardByCompany,
  createCard: createCardInDB,
  updateCardStatus
} = require("../../models/paymentsIssuedCardModel");
const { getAllMerchants, searchMerchants } = require("../constants/merchants");

/**
 * Issuing Controller
 * Handles Stripe Issuing operations for virtual card management
 */

// ==================== Enable Issuing Capability ====================

/**
 * Enable card_issuing and treasury capabilities for connected account
 * POST /api/payments/issuing/enable
 */
exports.enableIssuing = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Check if both capabilities are already enabled
    const issuingActive = accountRecord.capabilities?.issuing === CAPABILITY_STATUSES.ACTIVE;
    const treasuryActive = accountRecord.capabilities?.treasury === CAPABILITY_STATUSES.ACTIVE;

    if (issuingActive && treasuryActive) {
      return generateResponse(
        {
          accountId: connectedAccountId,
          issuingCapability: CAPABILITY_STATUSES.ACTIVE,
          treasuryCapability: CAPABILITY_STATUSES.ACTIVE,
          message: "Issuing and Treasury capabilities are already active"
        },
        "Issuing and Treasury capabilities are already active",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Enable Issuing and Treasury capabilities via Stripe
    const result = await issuingService.enableIssuingCapability(connectedAccountId);

    // Update database with new capability statuses
    await updateAccount(
      { companyId },
      {
        "capabilities.issuing": result.issuingCapability,
        "capabilities.treasury": result.treasuryCapability,
        "requirements.currentlyDue": result.requirementsCurrentlyDue,
        "requirements.eventuallyDue": result.requirementsEventuallyDue
      }
    );

    return generateResponse(
      {
        accountId: result.accountId,
        issuingCapability: result.issuingCapability,
        treasuryCapability: result.treasuryCapability,
        requirementsCurrentlyDue: result.requirementsCurrentlyDue,
        requirementsEventuallyDue: result.requirementsEventuallyDue
      },
      "Issuing and Treasury capabilities enabled successfully. Please complete any requirements if needed.",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error enabling Issuing and Treasury:", error);

    let message = "Failed to enable Issuing and Treasury capabilities";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

// ==================== Complete Issuing Requirements ====================

/**
 * Complete Issuing requirements to activate capability
 * POST /api/payments/issuing/complete-requirements
 */
exports.completeIssuingRequirements = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { annualRevenue, estimatedWorkerCount, tosAcceptance } = req.body;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Complete requirements via Stripe
    const result = await issuingService.completeIssuingRequirements(
      connectedAccountId,
      {
        annualRevenue,
        estimatedWorkerCount,
        tosAcceptance
      }
    );

    // Update database with new capability statuses
    await updateAccount(
      { companyId },
      {
        "capabilities.issuing": result.issuingCapability,
        "capabilities.treasury": result.treasuryCapability,
        "requirements.currentlyDue": result.requirementsCurrentlyDue,
        "requirements.eventuallyDue": result.requirementsEventuallyDue,
        "requirements.pastDue": result.requirementsPastDue
      }
    );

    // Determine message based on capability statuses
    let message;
    if (result.issuingCapability === "active" && result.treasuryCapability === "active") {
      message = "Issuing and Treasury capabilities activated successfully";
    } else if (result.requirementsCurrentlyDue.length > 0) {
      message = "Requirements submitted. Additional information needed to activate capabilities.";
    } else {
      message = "Requirements submitted. Issuing and Treasury capabilities are pending activation.";
    }

    return generateResponse(
      {
        accountId: result.accountId,
        issuingCapability: result.issuingCapability,
        treasuryCapability: result.treasuryCapability,
        requirementsCurrentlyDue: result.requirementsCurrentlyDue,
        requirementsEventuallyDue: result.requirementsEventuallyDue,
        requirementsPastDue: result.requirementsPastDue
      },
      message,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error completing Issuing requirements:", error);

    let message = "Failed to complete Issuing requirements";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

// ==================== Cardholder Management ====================

/**
 * Create cardholder for company
 * POST /api/payments/issuing/cardholder
 */
exports.createCardholder = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { firstName, lastName, email, phoneNumber, userIp, billing, notifications } = req.body;

    // Get user IP from request if not provided in body
    const ipAddress = userIp || req.ip || req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Check if cardholder already exists for this company
    const existingCardholder = await findCardholderByCompany(companyId);
    if (existingCardholder) {
      throw new Error("CARDHOLDER_ALREADY_EXISTS");
    }

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    // Check if Issuing capability is active
    if (accountRecord.capabilities?.issuing !== CAPABILITY_STATUSES.ACTIVE) {
      throw new Error("ISSUING_NOT_ACTIVE");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Create cardholder via Stripe
    const cardholderResult = await issuingService.createCardholder(
      connectedAccountId,
      {
        firstName,
        lastName,
        email,
        phoneNumber,
        userIp: ipAddress,
        billing
      }
    );

    // Save to database (type is "individual" for Connected Account Issuing)
    await createCardholderInDB({
      companyId,
      stripeAccountId: connectedAccountId,
      stripeCardholderId: cardholderResult.cardholderId,
      type: "individual",
      name: cardholderResult.name,
      firstName: cardholderResult.firstName,
      lastName: cardholderResult.lastName,
      email: cardholderResult.email,
      phoneNumber: cardholderResult.phoneNumber,
      billing: cardholderResult.billing,
      status: cardholderResult.status,
      notificationPreferences: notifications || {
        email: true,
        sms: false,
        push: false
      }
    });

    return generateResponse(
      {
        cardholderId: cardholderResult.cardholderId,
        name: cardholderResult.name,
        firstName: cardholderResult.firstName,
        lastName: cardholderResult.lastName,
        email: cardholderResult.email,
        status: cardholderResult.status
      },
      "Cardholder created successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error creating cardholder:", error);

    let message = "Failed to create cardholder";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "CARDHOLDER_ALREADY_EXISTS") {
      message = "Cardholder already exists for this company";
      statusCode = STATUS_CODES.CONFLICT;
    } else if (error.message === "ISSUING_NOT_ACTIVE") {
      message = "Issuing capability is not active. Please enable and complete Issuing requirements first.";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Delete cardholder for company
 * DELETE /api/payments/issuing/cardholder
 */
exports.deleteCardholder = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find cardholder for this company
    const cardholder = await findCardholderByCompany(companyId);
    if (!cardholder) {
      throw new Error("CARDHOLDER_NOT_FOUND");
    }

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Deactivate cardholder in Stripe if it's still active
    if (cardholder.status === "active") {
      try {
        await issuingService.updateCardholderStatus(
          connectedAccountId,
          cardholder.stripeCardholderId,
          "inactive"
        );
      } catch (stripeError) {
        // If Stripe returns an error (e.g., already inactive), log it but continue
        console.warn("Warning deactivating cardholder in Stripe:", stripeError.message);
      }
    }

    // Delete any issued cards for this cardholder from database
    const { deleteCards } = require("../../models/paymentsIssuedCardModel");
    await deleteCards({ cardholderId: cardholder._id });

    // Delete cardholder from database
    const { deleteCardholder: deleteCardholderFromDB } = require("../../models/paymentsCardholderModel");
    await deleteCardholderFromDB({ companyId });

    return generateResponse(
      {
        message: "Cardholder and associated cards deleted successfully"
      },
      "Cardholder and associated cards deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error deleting cardholder:", error);

    let message = "Failed to delete cardholder";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "CARDHOLDER_NOT_FOUND") {
      message = "No cardholder found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

// ==================== Card Management ====================

/**
 * Issue virtual card for company
 * POST /api/payments/issuing/card
 */
exports.issueCard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      currency = "usd",
      customName,
      spendingLimit,
      allowedMerchants,
      blockedMerchants,
      allowInternational,
      allowedCountries,
      blockedCountries,
      department,
      costCenter,
      projectId,
      validFrom,
      validUntil
    } = req.body;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Check if card already exists for this company (one card per company)
    const existingCard = await findCardByCompany(companyId);
    if (existingCard) {
      throw new Error("CARD_ALREADY_EXISTS");
    }

    // Find cardholder for this company
    const cardholder = await findCardholderByCompany(companyId);
    if (!cardholder) {
      throw new Error("CARDHOLDER_NOT_FOUND");
    }

    // Find Financial Account for this company
    const { findFinancialAccountByCompany } = require("../../models/paymentsFinancialAccountModel");
    const financialAccount = await findFinancialAccountByCompany(companyId);
    if (!financialAccount) {
      throw new Error("FINANCIAL_ACCOUNT_NOT_FOUND");
    }

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Issue card via Stripe with all new parameters
    const cardResult = await issuingService.issueCard(
      connectedAccountId,
      cardholder.stripeCardholderId,
      {
        currency,
        financialAccountId: financialAccount.stripeFinancialAccountId,
        customName,
        spendingLimit,
        allowedMerchants,
        blockedMerchants,
        allowInternational,
        allowedCountries,
        blockedCountries,
        department,
        costCenter,
        projectId,
        validFrom,
        validUntil
      }
    );

    // Determine if card is temporary
    const isTemporary = !!validUntil;

    // Save to database with all new fields
    await createCardInDB({
      cardholderId: cardholder._id,
      companyId,
      stripeAccountId: connectedAccountId,
      stripeCardId: cardResult.cardId,
      last4: cardResult.last4,
      brand: cardResult.brand,
      expMonth: cardResult.expMonth,
      expYear: cardResult.expYear,
      type: cardResult.type,
      status: cardResult.status,
      spendingControls: cardResult.spendingControls,
      metadata: cardResult.metadata,
      customName,
      department,
      costCenter,
      projectId,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      isTemporary
    });

    return generateResponse(
      {
        cardId: cardResult.cardId,
        last4: cardResult.last4,
        brand: cardResult.brand,
        expMonth: cardResult.expMonth,
        expYear: cardResult.expYear,
        currency: cardResult.currency,
        type: cardResult.type,
        status: cardResult.status,
        customName,
        spendingControls: cardResult.spendingControls,
        department,
        costCenter,
        validFrom,
        validUntil
      },
      "Card issued successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error issuing card:", error);

    let message = "Failed to issue card";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "CARDHOLDER_NOT_FOUND") {
      message = "Cardholder not found. Please create a cardholder first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "FINANCIAL_ACCOUNT_NOT_FOUND") {
      message = "Financial Account not found. Please create a Financial Account first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "CARD_ALREADY_EXISTS") {
      message = "Card already exists for this company";
      statusCode = STATUS_CODES.CONFLICT;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Get sensitive card details (full number, CVC)
 * GET /api/payments/issuing/card/details
 *
 * SECURITY CRITICAL:
 * - Admin only
 * - Audit log all access
 * - Never log returned values
 */
exports.getCardDetails = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId email");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find card for this company
    const card = await findCardByCompany(companyId);
    if (!card) {
      throw new Error("CARD_NOT_FOUND");
    }

    // Find connected account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // AUDIT LOG: Log access to sensitive card details
    console.log(`[AUDIT] Card details accessed - User: ${user.email}, Company: ${companyId}, CardId: ${card.stripeCardId}, Timestamp: ${new Date().toISOString()}`);

    // Retrieve sensitive details from Stripe
    const sensitiveDetails = await issuingService.getCardSensitiveDetails(
      connectedAccountId,
      card.stripeCardId
    );

    // Return sensitive data (WARNING: Never log this response)
    return generateResponse(
      {
        number: sensitiveDetails.number,
        cvc: sensitiveDetails.cvc,
        expMonth: sensitiveDetails.expMonth,
        expYear: sensitiveDetails.expYear,
        last4: sensitiveDetails.last4,
        brand: sensitiveDetails.brand
      },
      "Card details retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    // Only log error message, NOT card data
    console.error("Error retrieving card details:", error.message);

    let message = "Failed to retrieve card details";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "CARD_NOT_FOUND") {
      message = "No card found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Toggle card freeze status (active ↔ inactive)
 * POST /api/payments/issuing/card/toggle-freeze
 */
exports.toggleCardFreeze = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId email");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find card for this company
    const card = await findCardByCompany(companyId);
    if (!card) {
      throw new Error("CARD_NOT_FOUND");
    }

    // Find connected account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Toggle card status in Stripe
    const result = await issuingService.toggleCardFreeze(
      connectedAccountId,
      card.stripeCardId
    );

    // Update status in database
    await updateCardStatus(
      { stripeCardId: card.stripeCardId },
      result.newStatus
    );

    // Determine user-friendly message
    const message = result.isFrozen
      ? "Card frozen successfully"
      : "Card unfrozen successfully";

    return generateResponse(
      {
        cardId: result.cardId,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        isFrozen: result.isFrozen,
        last4: result.last4,
        brand: result.brand
      },
      message,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error toggling card freeze:", error.message);

    let message = "Failed to toggle card freeze";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "CARD_NOT_FOUND") {
      message = "No card found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message.includes("Cannot toggle canceled card")) {
      message = "Cannot toggle canceled card. Card is permanently canceled.";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Cancel an issued card (permanent action)
 * POST /api/payments/issuing/cards/:cardId/cancel
 */
exports.cancelCard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { cardId } = req.params;

    // 1. Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // 2. Find the issued card for this company
    const { findIssuedCardByCompany } = require("../../models/paymentsIssuedCardModel");
    const cardRecord = await findIssuedCardByCompany(companyId);

    if (!cardRecord) {
      throw new Error("CARD_NOT_FOUND");
    }

    // 3. Verify the cardId matches
    if (cardRecord.stripeCardId !== cardId) {
      throw new Error("CARD_MISMATCH");
    }

    // 4. Check if card is already canceled
    if (cardRecord.status === "canceled") {
      throw new Error("CARD_ALREADY_CANCELED");
    }

    // 5. Find connected account
    const { findAccountByCompany } = require("../../models/paymentsStripeAccountModel");
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // 6. Cancel the card via Stripe
    const result = await issuingService.cancelCard(cardId, connectedAccountId);

    // 7. Update local database
    const { updateIssuedCard } = require("../../models/paymentsIssuedCardModel");
    await updateIssuedCard(companyId, {
      status: "canceled",
      updatedAt: new Date()
    });

    return generateResponse(
      result,
      "Card canceled successfully. This action is permanent and cannot be undone.",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error canceling card:", error.message);

    let message = "Failed to cancel card";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "CARD_NOT_FOUND") {
      message = "No card found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "CARD_MISMATCH") {
      message = "Card ID does not match the card for this company";
      statusCode = STATUS_CODES.FORBIDDEN;
    } else if (error.message === "CARD_ALREADY_CANCELED") {
      message = "Card is already canceled";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * List transactions (purchase, refunds, deposit, send)
 * GET /api/payments/issuing/transactions
 */
exports.listTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, limit } = req.query;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Check if any cards have been issued for this company
    const { findCardsByCompany } = require("../../models/paymentsIssuedCardModel");
    const cards = await findCardsByCompany(companyId);

    if (cards.length === 0) {
      // No cards issued yet - return user-friendly message
      return generateResponse(
        {
          isIssued: false,
          message: "Please issue a card first",
          transactions: [],
          hasMore: false,
          count: 0
        },
        "No cards issued yet",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Find connected account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Get Financial Account if needed (for deposit/send types)
    let financialAccountId = null;
    if (!type || type === "deposit" || type === "send") {
      const { findFinancialAccountByCompany } = require("../../models/paymentsFinancialAccountModel");
      const financialAccount = await findFinancialAccountByCompany(companyId);

      // If requesting deposit/send specifically but no Financial Account exists, error
      if ((type === "deposit" || type === "send") && !financialAccount) {
        throw new Error("FINANCIAL_ACCOUNT_NOT_FOUND");
      }

      financialAccountId = financialAccount ? financialAccount.stripeFinancialAccountId : null;
    }

    // Get unified transactions (latest 100, no pagination)
    const result = await issuingService.getUnifiedTransactions(
      financialAccountId,
      connectedAccountId,
      {
        type,
        limit: Math.min(limit ? parseInt(limit) : 100, 100)
      }
    );

    return generateResponse(
      result,
      "Transactions retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error listing transactions:", error.message);

    let message = "Failed to list transactions";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "FINANCIAL_ACCOUNT_NOT_FOUND") {
      message = "Financial Account not found. Please create a Financial Account first to view deposit/send transactions.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message.includes("Financial Account required")) {
      message = error.message;
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

// ==================== Merchants Reference Data ====================

/**
 * Get list of available merchants for spending controls
 * GET /api/payments/issuing/merchants
 */
exports.getMerchants = async (req, res, next) => {
  try {
    const { search } = req.query;

    let merchants;
    if (search && search.trim()) {
      // Search merchants by name/description
      merchants = searchMerchants(search.trim());
    } else {
      // Return all merchants
      merchants = getAllMerchants();
    }

    return generateResponse(
      {
        merchants,
        count: merchants.length
      },
      "Merchants retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error getting merchants:", error);

    return generateResponse(
      { error: "Failed to retrieve merchants" },
      "Failed to retrieve merchants",
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

// ==================== Financial Account Management ====================

/**
 * Create Financial Account for company
 * POST /api/payments/issuing/financial-account
 */
exports.createFinancialAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Check if Financial Account already exists for this company
    const { findFinancialAccountByCompany, createFinancialAccount: createFinancialAccountInDB } = require("../../models/paymentsFinancialAccountModel");
    
    const existingAccount = await findFinancialAccountByCompany(companyId);
    if (existingAccount) {
      throw new Error("FINANCIAL_ACCOUNT_ALREADY_EXISTS");
    }

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    // Check if both treasury and card_issuing capabilities are active
    const treasuryActive = accountRecord.capabilities?.treasury === CAPABILITY_STATUSES.ACTIVE || 
                          accountRecord.capabilities?.treasury === "active";
    const issuingActive = accountRecord.capabilities?.issuing === CAPABILITY_STATUSES.ACTIVE ||
                         accountRecord.capabilities?.issuing === "active";

    if (!treasuryActive || !issuingActive) {
      throw new Error("CAPABILITIES_NOT_ACTIVE");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Create Financial Account via Stripe
    const financialAccountResult = await issuingService.createFinancialAccount(
      connectedAccountId,
      { currency: "usd" }
    );

    // Save to database
    await createFinancialAccountInDB({
      companyId,
      stripeAccountId: connectedAccountId,
      stripeFinancialAccountId: financialAccountResult.financialAccountId,
      supportedCurrencies: financialAccountResult.supportedCurrencies,
      status: financialAccountResult.status,
      features: financialAccountResult.features,
      balance: financialAccountResult.balance
    });

    return generateResponse(
      {
        financialAccountId: financialAccountResult.financialAccountId,
        supportedCurrencies: financialAccountResult.supportedCurrencies,
        status: financialAccountResult.status
      },
      "Financial Account created successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error creating Financial Account:", error);

    let message = "Failed to create Financial Account";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "FINANCIAL_ACCOUNT_ALREADY_EXISTS") {
      message = "Financial Account already exists for this company";
      statusCode = STATUS_CODES.CONFLICT;
    } else if (error.message === "CAPABILITIES_NOT_ACTIVE") {
      message = "Treasury and card_issuing capabilities must be active. Please complete account onboarding.";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

// ==================== Banking Operations ====================

/**
 * Create payout from Connected Account to linked external bank
 * POST /api/payments/banking/payout
 */
exports.payout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, description, method } = req.body;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Create payout via Stripe and save to local DB
    const payoutResult = await issuingService.createPayout(
      connectedAccountId,
      companyId,
      { amount, description, method }
    );

    return generateResponse(
      payoutResult,
      "Payout initiated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error creating payout:", error);

    let message = "Failed to create payout";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message.includes("balance_insufficient") || error.message.includes("insufficient")) {
      message = "Insufficient balance for this payout";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message.includes("payout_not_allowed")) {
      message = "Payouts are not enabled for this account";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message.includes("account_invalid")) {
      message = "Account not properly configured for payouts";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Fund card balance by transferring from Payments Balance to Issuing Balance
 * POST /api/payments/banking/fund-card
 */
exports.fundCard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, description } = req.body;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Fund card balance via Stripe Balance Transfers API and save to local DB
    const transferResult = await issuingService.fundCardBalance(
      connectedAccountId,
      companyId,
      { amount, description }
    );

    return generateResponse(
      transferResult,
      "Card balance funded successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error funding card balance:", error);

    let message = "Failed to fund card balance";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message.includes("balance_insufficient") || error.message.includes("insufficient")) {
      message = "Insufficient balance for this transfer";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message.includes("account_invalid")) {
      message = "Account not properly configured";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Get account balances (Connected Account + Financial Account)
 * GET /api/payments/banking/balance
 */
exports.getBalance = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Get Financial Account ID if exists
    let financialAccountId = null;
    const { findFinancialAccountByCompany } = require("../../models/paymentsFinancialAccountModel");
    const financialAccount = await findFinancialAccountByCompany(companyId);
    if (financialAccount) {
      financialAccountId = financialAccount.stripeFinancialAccountId;
    }

    // Get balances from Stripe
    const balances = await issuingService.getBalances(
      connectedAccountId,
      financialAccountId
    );

    return generateResponse(
      balances,
      "Balances retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error getting balances:", error);

    let message = "Failed to get balances";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

// ==================== Payout Settings ====================

/**
 * Get payout settings (schedule + instant eligibility)
 * GET /api/payments/banking/payout-settings
 */
exports.getPayoutSettings = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Get payout settings from Stripe
    const settings = await issuingService.getPayoutSettings(connectedAccountId);

    return generateResponse(
      settings,
      "Payout settings retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error getting payout settings:", error);

    let message = "Failed to get payout settings";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Update payout schedule
 * PUT /api/payments/banking/payout-settings
 */
exports.updatePayoutSettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { interval, delay_days, weekly_anchor } = req.body;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Find connected account for this company
    const accountRecord = await findAccountByCompany(companyId);

    if (!accountRecord) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }

    const connectedAccountId = accountRecord.stripeAccountId;

    // Update payout schedule in Stripe
    const settings = await issuingService.updatePayoutSchedule(
      connectedAccountId,
      { interval, delay_days, weekly_anchor }
    );

    return generateResponse(
      settings,
      "Payout settings updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error updating payout settings:", error);

    let message = "Failed to update payout settings";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "STRIPE_ACCOUNT_NOT_FOUND") {
      message = "Stripe account not found for this company. Please complete account setup first.";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

// ==================== Company-Wide Transactions ====================

/**
 * Get all transactions for company dashboard
 * GET /api/payments/banking/transactions
 */
exports.getAllTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, status, limit, page, startDate, endDate, search } = req.query;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const CompanyModel = model("Company");

    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Get company name for recipient field
    const company = await CompanyModel.findById(companyId).select("name");
    const companyName = company?.name || "Company";

    // Get all transactions
    const result = await issuingService.getAllCompanyTransactions(
      companyId,
      companyName,
      {
        type,
        status,
        limit: limit ? parseInt(limit) : 20,
        page: page ? parseInt(page) : 1,
        startDate,
        endDate,
        search
      }
    );

    return generateResponse(
      result,
      "Transactions retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error getting all transactions:", error);

    let message = "Failed to get transactions";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Update transaction labels
 * PUT /api/payments/banking/transactions/:id/labels
 */
exports.updateTransactionLabels = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { labels, source } = req.body;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    let updatedTransaction = null;

    // Update based on source type
    if (source === "invoice") {
      const { updateInvoiceLabels, findInvoiceById } = require("../../models/invoiceModel");

      // Verify invoice belongs to this company
      const invoice = await findInvoiceById(id);
      if (!invoice || invoice.companyId.toString() !== companyId.toString()) {
        throw new Error("TRANSACTION_NOT_FOUND");
      }

      updatedTransaction = await updateInvoiceLabels(id, labels);
    } else if (source === "payout" || source === "fund_card") {
      const {
        updateBankingTransactionLabels,
        findBankingTransactionById
      } = require("../../models/paymentsBankingTransactionModel");

      // Verify banking transaction belongs to this company
      const bankingTxn = await findBankingTransactionById(id);
      if (!bankingTxn || bankingTxn.companyId.toString() !== companyId.toString()) {
        throw new Error("TRANSACTION_NOT_FOUND");
      }

      updatedTransaction = await updateBankingTransactionLabels(id, labels);
    } else {
      throw new Error("INVALID_SOURCE");
    }

    return generateResponse(
      { id, labels: updatedTransaction.labels, source },
      "Labels updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error updating transaction labels:", error);

    let message = "Failed to update labels";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message === "TRANSACTION_NOT_FOUND") {
      message = "Transaction not found or access denied";
      statusCode = STATUS_CODES.NOT_FOUND;
    } else if (error.message === "INVALID_SOURCE") {
      message = "Invalid source type. Must be 'invoice', 'payout', or 'fund_card'";
      statusCode = STATUS_CODES.BAD_REQUEST;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};

/**
 * Export transactions as CSV
 * GET /api/payments/banking/transactions/export
 */
exports.exportTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, status, startDate, endDate, search } = req.query;

    // Fetch user to get companyId
    const { model } = require("mongoose");
    const UserModel = model("User");
    const CompanyModel = model("Company");

    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const companyId = user.companyId;

    // Get company name for recipient field
    const company = await CompanyModel.findById(companyId).select("name");
    const companyName = company?.name || "Company";

    // Get all transactions (no pagination)
    const transactions = await issuingService.getAllCompanyTransactionsForExport(
      companyId,
      companyName,
      { type, status, startDate, endDate, search }
    );

    // Generate CSV
    const csvRows = [];

    // Header row
    csvRows.push([
      "Date",
      "Transaction ID",
      "Type",
      "Amount",
      "Currency",
      "Sender",
      "Recipient",
      "Status",
      "Labels",
      "Source"
    ].join(","));

    // Data rows
    for (const txn of transactions) {
      const formattedDate = new Date(txn.date).toISOString().split("T")[0];
      const formattedAmount = `$${(txn.amount / 100).toFixed(2)}`;
      const labelsStr = (txn.labels || []).join("; ");

      // Escape fields that might contain commas or quotes
      const escapeCSV = (str) => {
        if (str == null) return "";
        const s = String(str);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      csvRows.push([
        formattedDate,
        txn.id,
        escapeCSV(txn.type),
        formattedAmount,
        txn.currency.toUpperCase(),
        escapeCSV(txn.sender),
        escapeCSV(txn.recipient),
        txn.status,
        escapeCSV(labelsStr),
        txn.source
      ].join(","));
    }

    const csvContent = csvRows.join("\n");
    const filename = `transactions-${new Date().toISOString().split("T")[0]}.csv`;

    // Set headers for file download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    return res.send(csvContent);
  } catch (error) {
    console.error("Error exporting transactions:", error);

    let message = "Failed to export transactions";
    let statusCode = STATUS_CODES.BAD_REQUEST;

    if (error.message === "USER_NOT_FOUND") {
      message = "User not found";
      statusCode = STATUS_CODES.UNAUTHORIZED;
    } else if (error.message) {
      message = error.message;
    }

    return generateResponse(
      { error: message },
      message,
      res,
      statusCode
    );
  }
};
