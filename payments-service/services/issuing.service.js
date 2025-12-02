"use strict";

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const {
  createBankingTransaction,
  updateBankingTransaction
} = require("../../models/paymentsBankingTransactionModel");

/**
 * Stripe Issuing Service
 * Handles all Stripe Issuing API operations for virtual card issuance
 */

// ==================== Capability Management ====================

/**
 * Enable card_issuing and treasury capabilities for connected account
 * @param {string} connectedAccountId - Stripe connected account ID
 * @returns {object} Updated account with capability statuses
 */
exports.enableIssuingCapability = async (connectedAccountId) => {
  try {
    // Request both card_issuing and treasury capabilities
    const account = await stripe.accounts.update(connectedAccountId, {
      capabilities: {
        card_issuing: { requested: true },
        treasury: { requested: true }
      }
    });

    return {
      accountId: account.id,
      issuingCapability: account.capabilities.card_issuing,
      treasuryCapability: account.capabilities.treasury,
      requirementsCurrentlyDue: account.requirements.currently_due || [],
      requirementsEventuallyDue: account.requirements.eventually_due || []
    };
  } catch (error) {
    console.error("Error enabling Issuing and Treasury capabilities:", error);
    throw new Error(error.message || "Failed to enable Issuing and Treasury capabilities");
  }
};

/**
 * Get Issuing capability status for connected account
 * @param {string} connectedAccountId - Stripe connected account ID
 * @returns {object} Capability status and requirements
 */
exports.getIssuingCapabilityStatus = async (connectedAccountId) => {
  try {
    const account = await stripe.accounts.retrieve(connectedAccountId);

    return {
      accountId: account.id,
      issuingCapability: account.capabilities.card_issuing || "inactive",
      requirementsCurrentlyDue: account.requirements.currently_due || [],
      requirementsEventuallyDue: account.requirements.eventually_due || [],
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled
    };
  } catch (error) {
    console.error("Error getting Issuing capability status:", error);
    throw new Error(error.message || "Failed to get Issuing capability status");
  }
};

/**
 * Complete Issuing and Treasury requirements for connected account
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} requirements - Required fields (all optional, at least one must be provided)
 * @param {object} requirements.annualRevenue - Annual revenue details (optional)
 * @param {number} requirements.annualRevenue.amount - Revenue in cents
 * @param {string} requirements.annualRevenue.currency - Currency code
 * @param {string} requirements.annualRevenue.fiscalYearEnd - Fiscal year end date
 * @param {number} requirements.estimatedWorkerCount - Worker count (optional)
 * @param {object} requirements.tosAcceptance - TOS acceptance details (optional)
 * @param {number} requirements.tosAcceptance.date - Unix timestamp
 * @param {string} requirements.tosAcceptance.ip - IP address
 * @returns {object} Updated account with capability statuses
 */
exports.completeIssuingRequirements = async (connectedAccountId, requirements) => {
  try {
    const { annualRevenue, estimatedWorkerCount, tosAcceptance } = requirements;

    // Build update payload dynamically based on provided fields
    const updatePayload = {};

    // Add business profile if annualRevenue or estimatedWorkerCount provided
    if (annualRevenue || estimatedWorkerCount) {
      updatePayload.business_profile = {};

      if (annualRevenue) {
        updatePayload.business_profile.annual_revenue = {
          amount: annualRevenue.amount,
          currency: annualRevenue.currency,
          fiscal_year_end: annualRevenue.fiscalYearEnd
        };
      }

      if (estimatedWorkerCount) {
        updatePayload.business_profile.estimated_worker_count = estimatedWorkerCount;
      }
    }

    // Add TOS acceptance for both card_issuing and treasury if provided
    if (tosAcceptance) {
      updatePayload.settings = {
        card_issuing: {
          tos_acceptance: {
            date: tosAcceptance.date,
            ip: tosAcceptance.ip
          }
        },
        treasury: {
          tos_acceptance: {
            date: tosAcceptance.date,
            ip: tosAcceptance.ip
          }
        }
      };
    }

    // Update connected account with provided fields
    const account = await stripe.accounts.update(connectedAccountId, updatePayload);

    return {
      accountId: account.id,
      issuingCapability: account.capabilities.card_issuing,
      treasuryCapability: account.capabilities.treasury,
      requirementsCurrentlyDue: account.requirements.currently_due || [],
      requirementsEventuallyDue: account.requirements.eventually_due || [],
      requirementsPastDue: account.requirements.past_due || []
    };
  } catch (error) {
    console.error("Error completing Issuing and Treasury requirements:", error);
    throw new Error(error.message || "Failed to complete Issuing and Treasury requirements");
  }
};

// ==================== Cardholder Management ====================

/**
 * Create Issuing cardholder for connected account
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} cardholderData - Cardholder details
 * @param {string} cardholderData.firstName - Individual first name
 * @param {string} cardholderData.lastName - Individual last name
 * @param {string} cardholderData.email - Contact email
 * @param {string} cardholderData.phoneNumber - Contact phone (optional)
 * @param {string} cardholderData.userIp - User's IP address for terms acceptance
 * @param {object} cardholderData.billing - Billing address (required)
 * @returns {object} Created cardholder
 */
exports.createCardholder = async (connectedAccountId, cardholderData) => {
  try {
    const { firstName, lastName, email, phoneNumber, userIp, billing } = cardholderData;

    // Full name for cardholder (max 24 characters)
    const fullName = `${firstName} ${lastName}`.substring(0, 24);

    // For Connected Account Issuing, type must be "individual"
    const cardholderPayload = {
      name: fullName,
      email,
      type: "individual",
      status: "active",
      individual: {
        first_name: firstName,
        last_name: lastName,
        card_issuing: {
          user_terms_acceptance: {
            date: Math.floor(Date.now() / 1000), // Current Unix timestamp
            ip: userIp
          }
        }
      }
    };

    // Add optional phone number
    if (phoneNumber) {
      cardholderPayload.phone_number = phoneNumber;
    }

    // Add required billing address
    cardholderPayload.billing = {
      address: {
        line1: billing.address.line1,
        city: billing.address.city,
        postal_code: billing.address.postal_code,
        country: billing.address.country
      }
    };

    // Only add optional address fields if they have values
    if (billing.address.line2) {
      cardholderPayload.billing.address.line2 = billing.address.line2;
    }
    if (billing.address.state) {
      cardholderPayload.billing.address.state = billing.address.state;
    }

    // Create cardholder on connected account
    const cardholder = await stripe.issuing.cardholders.create(
      cardholderPayload,
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      cardholderId: cardholder.id,
      name: cardholder.name,
      firstName: cardholder.individual?.first_name,
      lastName: cardholder.individual?.last_name,
      email: cardholder.email,
      phoneNumber: cardholder.phone_number,
      type: cardholder.type,
      status: cardholder.status,
      billing: cardholder.billing
    };
  } catch (error) {
    console.error("Error creating cardholder:", error);
    throw new Error(error.message || "Failed to create cardholder");
  }
};

/**
 * Update cardholder status (deactivate/reactivate)
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} cardholderId - Stripe cardholder ID
 * @param {string} status - New status: "active" or "inactive"
 * @returns {object} Updated cardholder
 */
exports.updateCardholderStatus = async (connectedAccountId, cardholderId, status) => {
  try {
    const cardholder = await stripe.issuing.cardholders.update(
      cardholderId,
      { status },
      { stripeAccount: connectedAccountId }
    );

    return {
      cardholderId: cardholder.id,
      status: cardholder.status
    };
  } catch (error) {
    console.error("Error updating cardholder status:", error);
    throw new Error(error.message || "Failed to update cardholder status");
  }
};

// ==================== Card Management ====================

/**
 * Build spending controls object for Stripe
 * @param {object} controlsData - Spending control parameters
 * @returns {object} Stripe spending_controls object
 */
const buildSpendingControls = (controlsData) => {
  const {
    spendingLimit = null,
    allowedMerchants = [],
    blockedMerchants = [],
    allowInternational = true,
    allowedCountries = [],
    blockedCountries = [],
    currency = "usd"
  } = controlsData;

  const spendingControls = {};

  // Add spending limit (single card-wide limit)
  if (spendingLimit && spendingLimit.amount && spendingLimit.interval) {
    spendingControls.spending_limits = [{
      amount: spendingLimit.amount,
      interval: spendingLimit.interval
    }];
  }

  // Add merchant controls (mutually exclusive)
  if (allowedMerchants && allowedMerchants.length > 0) {
    spendingControls.allowed_categories = allowedMerchants;
  } else if (blockedMerchants && blockedMerchants.length > 0) {
    spendingControls.blocked_categories = blockedMerchants;
  }

  // Add country controls (mutually exclusive)
  if (!allowInternational) {
    // Block all international - only allow US (or default domestic country)
    spendingControls.allowed_merchant_countries = ["US"];
  } else if (allowedCountries && allowedCountries.length > 0) {
    spendingControls.allowed_merchant_countries = allowedCountries;
  } else if (blockedCountries && blockedCountries.length > 0) {
    spendingControls.blocked_merchant_countries = blockedCountries;
  }

  // Only return if we have controls
  return Object.keys(spendingControls).length > 0 ? spendingControls : null;
};

/**
 * Issue virtual card for cardholder
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} cardholderId - Stripe cardholder ID
 * @param {object} cardData - Card details
 * @param {string} cardData.currency - Card currency (default: "usd")
 * @param {string} cardData.financialAccountId - Financial Account ID (required for platforms)
 * @param {string} cardData.customName - Custom card label
 * @param {object} cardData.spendingLimit - Spending limit object with amount and interval
 * @param {array} cardData.allowedMerchants - Allowed merchants (Stripe MCC codes)
 * @param {array} cardData.blockedMerchants - Blocked merchants (Stripe MCC codes)
 * @param {boolean} cardData.allowInternational - Allow international transactions
 * @param {array} cardData.allowedCountries - Allowed country codes
 * @param {array} cardData.blockedCountries - Blocked country codes
 * @param {string} cardData.department - Department assignment
 * @param {string} cardData.costCenter - Cost center code
 * @param {string} cardData.projectId - Project ID
 * @param {Date} cardData.validFrom - Start date for card validity
 * @param {Date} cardData.validUntil - End date for card validity
 * @returns {object} Created card
 */
exports.issueCard = async (connectedAccountId, cardholderId, cardData = {}) => {
  try {
    const {
      currency = "usd",
      financialAccountId,
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
    } = cardData;

    // Build card payload
    const cardPayload = {
      cardholder: cardholderId,
      currency,
      type: "virtual",
      status: "active",
      financial_account: financialAccountId
    };

    // Add spending controls if provided
    const spendingControls = buildSpendingControls({
      spendingLimit,
      allowedMerchants,
      blockedMerchants,
      allowInternational,
      allowedCountries,
      blockedCountries,
      currency
    });

    if (spendingControls) {
      cardPayload.spending_controls = spendingControls;
    }

    // Add custom expiration if validUntil provided
    if (validUntil) {
      const expiryDate = new Date(validUntil);
      cardPayload.exp_month = expiryDate.getMonth() + 1;
      cardPayload.exp_year = expiryDate.getFullYear();
    }

    // Build metadata for Stripe
    const metadata = {};
    if (customName) metadata.custom_name = customName;
    if (department) metadata.department = department;
    if (costCenter) metadata.cost_center = costCenter;
    if (projectId) metadata.project_id = projectId;
    if (validFrom) metadata.valid_from = new Date(validFrom).toISOString();
    if (validUntil) metadata.valid_until = new Date(validUntil).toISOString();

    if (Object.keys(metadata).length > 0) {
      cardPayload.metadata = metadata;
    }

    // Create virtual card
    const card = await stripe.issuing.cards.create(
      cardPayload,
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      cardId: card.id,
      cardholderId: card.cardholder,
      last4: card.last4,
      brand: card.brand,
      expMonth: card.exp_month,
      expYear: card.exp_year,
      currency: card.currency,
      type: card.type,
      status: card.status,
      spendingControls: card.spending_controls,
      metadata: card.metadata
    };
  } catch (error) {
    console.error("Error issuing card:", error);
    throw new Error(error.message || "Failed to issue card");
  }
};

/**
 * Get sensitive card details (full number, CVC)
 * WARNING: PCI-DSS sensitive - handle with extreme care
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} cardId - Stripe card ID
 * @returns {object} Sensitive card details
 */
exports.getCardSensitiveDetails = async (connectedAccountId, cardId) => {
  try {
    // Retrieve card with expanded sensitive fields
    // CRITICAL: expand parameter is required to get number and cvc
    const card = await stripe.issuing.cards.retrieve(
      cardId,
      {
        expand: ["number", "cvc"]
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      cardId: card.id,
      number: card.number,      // Full card number (string)
      cvc: card.cvc,            // CVC code (string)
      expMonth: card.exp_month, // Expiry month (number)
      expYear: card.exp_year,   // Expiry year (number)
      last4: card.last4,
      brand: card.brand
    };
  } catch (error) {
    console.error("Error retrieving card sensitive details:", error);
    throw new Error(error.message || "Failed to retrieve card sensitive details");
  }
};

/**
 * Toggle card freeze status (active ↔ inactive)
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} cardId - Stripe card ID
 * @returns {object} Updated card status
 */
exports.toggleCardFreeze = async (connectedAccountId, cardId) => {
  try {
    // 1. Retrieve current card status
    const card = await stripe.issuing.cards.retrieve(
      cardId,
      {},
      {
        stripeAccount: connectedAccountId
      }
    );

    const currentStatus = card.status;

    // 2. Determine new status based on current state
    let newStatus;
    if (currentStatus === "active") {
      newStatus = "inactive"; // Freeze the card
    } else if (currentStatus === "inactive") {
      newStatus = "active"; // Unfreeze the card
    } else if (currentStatus === "canceled") {
      throw new Error("Cannot toggle canceled card. Card is permanently canceled.");
    } else {
      throw new Error(`Unknown card status: ${currentStatus}`);
    }

    // 3. Update card status
    const updatedCard = await stripe.issuing.cards.update(
      cardId,
      {
        status: newStatus
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    // 4. Return toggle result
    return {
      cardId: updatedCard.id,
      previousStatus: currentStatus,
      newStatus: updatedCard.status,
      isFrozen: updatedCard.status === "inactive",
      last4: updatedCard.last4,
      brand: updatedCard.brand
    };
  } catch (error) {
    console.error("Error toggling card freeze:", error);
    throw new Error(error.message || "Failed to toggle card freeze");
  }
};

/**
 * Cancel an issued card (permanent action)
 * @param {string} cardId - Stripe card ID
 * @param {string} connectedAccountId - Stripe connected account ID
 * @returns {object} Canceled card details
 */
exports.cancelCard = async (cardId, connectedAccountId) => {
  try {
    // Cancel the card by updating status to "canceled"
    const canceledCard = await stripe.issuing.cards.update(
      cardId,
      {
        status: "canceled"
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      cardId: canceledCard.id,
      status: canceledCard.status,
      last4: canceledCard.last4,
      brand: canceledCard.brand,
      cardholderId: canceledCard.cardholder
    };
  } catch (error) {
    console.error("Error canceling card:", error);
    throw new Error(error.message || "Failed to cancel card");
  }
};

// ==================== Transaction Management ====================

/**
 * List Issuing transactions (card purchases and refunds)
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} filters - Filter options
 * @param {string} filters.type - Transaction type: 'capture' or 'refund'
 * @param {number} filters.limit - Max results (1-100, default: 20)
 * @param {string} filters.starting_after - Cursor for pagination
 * @returns {object} List of issuing transactions
 */
exports.listIssuingTransactions = async (connectedAccountId, filters = {}) => {
  try {
    const params = {
      limit: Math.min(filters.limit || 100, 100),
      ...(filters.type && { type: filters.type })
    };

    const transactions = await stripe.issuing.transactions.list(
      params,
      {
        stripeAccount: connectedAccountId
      }
    );

    return transactions;
  } catch (error) {
    console.error("Error listing issuing transactions:", error);
    throw new Error(error.message || "Failed to list issuing transactions");
  }
};

/**
 * List inbound transfers (deposits to Financial Account)
 * @param {string} financialAccountId - Stripe Financial Account ID
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} filters - Filter options
 * @param {number} filters.limit - Max results (1-100, default: 20)
 * @param {string} filters.starting_after - Cursor for pagination
 * @returns {object} List of inbound transfers
 */
exports.listInboundTransfers = async (financialAccountId, connectedAccountId, filters = {}) => {
  try {
    const params = {
      financial_account: financialAccountId,
      limit: Math.min(filters.limit || 100, 100)
    };

    const transfers = await stripe.treasury.inboundTransfers.list(
      params,
      {
        stripeAccount: connectedAccountId
      }
    );

    return transfers;
  } catch (error) {
    console.error("Error listing inbound transfers:", error);
    throw new Error(error.message || "Failed to list inbound transfers");
  }
};

/**
 * List outbound transfers (sends from Financial Account to own bank)
 * @param {string} financialAccountId - Stripe Financial Account ID
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} filters - Filter options
 * @param {number} filters.limit - Max results (1-100, default: 20)
 * @param {string} filters.starting_after - Cursor for pagination
 * @returns {object} List of outbound transfers
 */
exports.listOutboundTransfers = async (financialAccountId, connectedAccountId, filters = {}) => {
  try {
    const params = {
      financial_account: financialAccountId,
      limit: Math.min(filters.limit || 100, 100)
    };

    const transfers = await stripe.treasury.outboundTransfers.list(
      params,
      {
        stripeAccount: connectedAccountId
      }
    );

    return transfers;
  } catch (error) {
    console.error("Error listing outbound transfers:", error);
    throw new Error(error.message || "Failed to list outbound transfers");
  }
};

/**
 * List outbound payments (sends from Financial Account to third parties)
 * @param {string} financialAccountId - Stripe Financial Account ID
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} filters - Filter options
 * @param {number} filters.limit - Max results (1-100, default: 20)
 * @param {string} filters.starting_after - Cursor for pagination
 * @returns {object} List of outbound payments
 */
exports.listOutboundPayments = async (financialAccountId, connectedAccountId, filters = {}) => {
  try {
    const params = {
      financial_account: financialAccountId,
      limit: Math.min(filters.limit || 100, 100)
    };

    const payments = await stripe.treasury.outboundPayments.list(
      params,
      {
        stripeAccount: connectedAccountId
      }
    );

    return payments;
  } catch (error) {
    console.error("Error listing outbound payments:", error);
    throw new Error(error.message || "Failed to list outbound payments");
  }
};

/**
 * List received credits (deposits from external sources)
 * @param {string} financialAccountId - Stripe Financial Account ID
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} filters - Filter options
 * @param {number} filters.limit - Max results (1-100, default: 20)
 * @param {string} filters.starting_after - Cursor for pagination
 * @returns {object} List of received credits
 */
exports.listReceivedCredits = async (financialAccountId, connectedAccountId, filters = {}) => {
  try {
    const params = {
      financial_account: financialAccountId,
      limit: Math.min(filters.limit || 100, 100)
    };

    const credits = await stripe.treasury.receivedCredits.list(
      params,
      {
        stripeAccount: connectedAccountId
      }
    );

    return credits;
  } catch (error) {
    console.error("Error listing received credits:", error);
    throw new Error(error.message || "Failed to list received credits");
  }
};

/**
 * List received debits (debits by external sources)
 * @param {string} financialAccountId - Stripe Financial Account ID
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} filters - Filter options
 * @param {number} filters.limit - Max results (1-100, default: 20)
 * @param {string} filters.starting_after - Cursor for pagination
 * @returns {object} List of received debits
 */
exports.listReceivedDebits = async (financialAccountId, connectedAccountId, filters = {}) => {
  try {
    const params = {
      financial_account: financialAccountId,
      limit: Math.min(filters.limit || 100, 100)
    };

    const debits = await stripe.treasury.receivedDebits.list(
      params,
      {
        stripeAccount: connectedAccountId
      }
    );

    return debits;
  } catch (error) {
    console.error("Error listing received debits:", error);
    throw new Error(error.message || "Failed to list received debits");
  }
};

/**
 * Get unified transactions from multiple sources
 * @param {string} financialAccountId - Stripe Financial Account ID (optional for purchase/refunds only)
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} filters - Filter options
 * @param {string} filters.type - Transaction type: 'purchase', 'refunds', 'deposit', 'send' (optional)
 * @param {number} filters.limit - Max results (1-100, default: 100)
 * @returns {object} Unified transaction list
 */
exports.getUnifiedTransactions = async (financialAccountId, connectedAccountId, filters = {}) => {
  try {
    const limit = Math.min(filters.limit || 100, 100);
    const { type } = filters;

    let transactions = [];
    let hasMore = false;

    // Filter by type or fetch all
    if (type === "purchase") {
      // Only card purchases (captures)
      const result = await exports.listIssuingTransactions(connectedAccountId, {
        type: "capture",
        limit
      });
      transactions = result.data.map(txn => formatIssuingTransaction(txn, "purchase"));
      hasMore = false;

    } else if (type === "refunds") {
      // Only refunds
      const result = await exports.listIssuingTransactions(connectedAccountId, {
        type: "refund",
        limit
      });
      transactions = result.data.map(txn => formatIssuingTransaction(txn, "refunds"));
      hasMore = false;

    } else if (type === "deposit") {
      // Only deposits (inbound transfers + received credits)
      if (!financialAccountId) {
        throw new Error("Financial Account required for deposit transactions");
      }
      const [inboundTransfers, receivedCredits] = await Promise.all([
        exports.listInboundTransfers(financialAccountId, connectedAccountId, {
          limit: Math.ceil(limit / 2)
        }),
        exports.listReceivedCredits(financialAccountId, connectedAccountId, {
          limit: Math.ceil(limit / 2)
        })
      ]);

      const allDeposits = [
        ...inboundTransfers.data.map(txn => formatTreasuryTransaction(txn, "deposit")),
        ...receivedCredits.data.map(txn => formatTreasuryTransaction(txn, "deposit"))
      ];

      // Sort by created date (descending) and limit
      transactions = allDeposits.sort((a, b) => b.created - a.created).slice(0, limit);
      hasMore = false;

    } else if (type === "send") {
      // Only sends (outbound transfers + payments + received debits)
      if (!financialAccountId) {
        throw new Error("Financial Account required for send transactions");
      }
      const [outboundTransfers, outboundPayments, receivedDebits] = await Promise.all([
        exports.listOutboundTransfers(financialAccountId, connectedAccountId, {
          limit: Math.ceil(limit / 3)
        }),
        exports.listOutboundPayments(financialAccountId, connectedAccountId, {
          limit: Math.ceil(limit / 3)
        }),
        exports.listReceivedDebits(financialAccountId, connectedAccountId, {
          limit: Math.ceil(limit / 3)
        })
      ]);

      const allSends = [
        ...outboundTransfers.data.map(txn => formatTreasuryTransaction(txn, "send")),
        ...outboundPayments.data.map(txn => formatTreasuryTransaction(txn, "send")),
        ...receivedDebits.data.map(txn => formatTreasuryTransaction(txn, "send"))
      ];

      // Sort by created date (descending) and limit
      transactions = allSends.sort((a, b) => b.created - a.created).slice(0, limit);
      hasMore = false;

    } else {
      // No filter - fetch all types and merge
      const [issuing, inbound, outbound, payments, receivedCredits, receivedDebits] = await Promise.all([
        exports.listIssuingTransactions(connectedAccountId, { limit }),
        financialAccountId ? exports.listInboundTransfers(financialAccountId, connectedAccountId, { limit }) : { data: [] },
        financialAccountId ? exports.listOutboundTransfers(financialAccountId, connectedAccountId, { limit }) : { data: [] },
        financialAccountId ? exports.listOutboundPayments(financialAccountId, connectedAccountId, { limit }) : { data: [] },
        financialAccountId ? exports.listReceivedCredits(financialAccountId, connectedAccountId, { limit }) : { data: [] },
        financialAccountId ? exports.listReceivedDebits(financialAccountId, connectedAccountId, { limit }) : { data: [] }
      ]);

      const all = [
        ...issuing.data.map(txn => formatIssuingTransaction(txn, txn.type === "capture" ? "purchase" : "refunds")),
        ...inbound.data.map(txn => formatTreasuryTransaction(txn, "deposit")),
        ...outbound.data.map(txn => formatTreasuryTransaction(txn, "send")),
        ...payments.data.map(txn => formatTreasuryTransaction(txn, "send")),
        ...receivedCredits.data.map(txn => formatTreasuryTransaction(txn, "deposit")),
        ...receivedDebits.data.map(txn => formatTreasuryTransaction(txn, "send"))
      ];

      // Sort by created date (descending) and limit
      transactions = all.sort((a, b) => b.created - a.created).slice(0, limit);
      hasMore = false;
    }

    return {
      transactions,
      hasMore,
      count: transactions.length
    };
  } catch (error) {
    console.error("Error getting unified transactions:", error);
    throw new Error(error.message || "Failed to get unified transactions");
  }
};

/**
 * Format Issuing transaction to unified format
 */
function formatIssuingTransaction(txn, type) {
  return {
    id: txn.id,
    type,
    amount: txn.amount,
    currency: txn.currency,
    created: txn.created,
    description: txn.merchant_data ? `${type.toUpperCase()} at ${txn.merchant_data.name || "Unknown"}` : type.toUpperCase(),
    merchant: txn.merchant_data ? {
      name: txn.merchant_data.name,
      city: txn.merchant_data.city,
      country: txn.merchant_data.country,
      category: txn.merchant_data.category
    } : null,
    status: "complete",
    source: "issuing"
  };
}

/**
 * Format Treasury transaction to unified format
 */
function formatTreasuryTransaction(txn, type) {
  return {
    id: txn.id,
    type,
    amount: txn.amount,
    currency: txn.currency,
    created: txn.created,
    description: txn.description || txn.statement_descriptor || type.toUpperCase(),
    status: txn.status,
    source: "treasury"
  };
}

// ==================== Financial Account Management ====================

/**
 * Create Financial Account for connected account
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} options - Configuration options
 * @param {string} options.currency - Primary currency (default: "usd")
 * @returns {object} Created Financial Account
 */
exports.createFinancialAccount = async (connectedAccountId, options = {}) => {
  try {
    const { currency = "usd" } = options;

    // Create Financial Account with Issuing features
    const financialAccount = await stripe.treasury.financialAccounts.create(
      {
        supported_currencies: [currency],
        features: {
          card_issuing: { requested: true },
          deposit_insurance: { requested: true },
          inbound_transfers: {
            ach: { requested: true }
          },
          intra_stripe_flows: { requested: true }
        }
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      financialAccountId: financialAccount.id,
      supportedCurrencies: financialAccount.supported_currencies,
      status: financialAccount.status,
      features: financialAccount.features,
      balance: financialAccount.balance
    };
  } catch (error) {
    console.error("Error creating Financial Account:", error);
    throw new Error(error.message || "Failed to create Financial Account");
  }
};

// ==================== Banking Operations ====================

/**
 * Create payout from Connected Account to linked external bank
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} companyId - Company MongoDB ID (for local storage)
 * @param {object} data - Payout details
 * @param {number} data.amount - Amount in cents
 * @param {string} data.description - Payout description (optional)
 * @param {string} data.method - 'standard' (2-3 days) or 'instant' (minutes)
 * @returns {object} Created payout
 */
exports.createPayout = async (connectedAccountId, companyId, data) => {
  try {
    const { amount, description, method = "standard" } = data;

    const payout = await stripe.payouts.create(
      {
        amount,
        currency: "usd",
        description: description || "Payout to bank",
        method // 'standard' or 'instant'
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    // Get destination bank info if available
    let destination = null;
    if (payout.destination) {
      try {
        const bankAccount = await stripe.accounts.retrieveExternalAccount(
          connectedAccountId,
          payout.destination
        );
        destination = {
          last4: bankAccount.last4,
          bankName: bankAccount.bank_name,
          routingNumber: bankAccount.routing_number
        };
      } catch (err) {
        // Bank details not retrievable, continue without them
        console.log("Could not retrieve bank account details:", err.message);
      }
    }

    // Save transaction locally for company-wide transaction history
    if (companyId) {
      try {
        await createBankingTransaction({
          companyId,
          stripeTransactionId: payout.id,
          stripeAccountId: connectedAccountId,
          type: "payout",
          amount: payout.amount,
          currency: payout.currency,
          status: payout.status,
          description: payout.description,
          method: payout.method,
          destination,
          arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null
        });
      } catch (dbErr) {
        console.error("Error saving payout to local DB:", dbErr.message);
        // Don't throw - payout was created successfully in Stripe
      }
    }

    return {
      id: payout.id,
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status,
      arrival_date: payout.arrival_date,
      method: payout.method,
      description: payout.description,
      destination
    };
  } catch (error) {
    console.error("Error creating payout:", error);
    throw new Error(error.message || "Failed to create payout");
  }
};

/**
 * Fund card balance by transferring funds to the Financial Account (Issuing Balance)
 * Uses Treasury receivedCredits test helper in test mode, raw API in production
 * Note: Balance Transfers API is in private beta, so we use Treasury testHelpers for test mode
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} companyId - Company MongoDB ID (for local storage)
 * @param {object} data - Transfer details
 * @param {number} data.amount - Amount in cents
 * @param {string} data.description - Transfer description (optional)
 * @returns {object} Created balance transfer
 */
exports.fundCardBalance = async (connectedAccountId, companyId, data) => {
  try {
    const { amount, description } = data;

    // Get Financial Account ID from database (required for Treasury operations)
    const {
      findFinancialAccountByCompany
    } = require("../../models/paymentsFinancialAccountModel");
    const faRecord = await findFinancialAccountByCompany(companyId);

    if (!faRecord || !faRecord.stripeFinancialAccountId) {
      throw new Error(
        "Financial Account not found. Treasury must be enabled first."
      );
    }

    const financialAccountId = faRecord.stripeFinancialAccountId;

    let transfer;

    // Check if we're in test mode
    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_test");

    if (isTestMode) {
      // Use Treasury test helper to simulate funding
      // This is the same pattern used in scripts/simulate-transactions.js
      const receivedCredit =
        await stripe.testHelpers.treasury.receivedCredits.create(
          {
            financial_account: financialAccountId,
            amount,
            currency: "usd",
            network: "us_domestic_wire",
            description: description || "Fund card balance"
          },
          { stripeAccount: connectedAccountId }
        );

      transfer = {
        id: receivedCredit.id,
        amount: receivedCredit.amount,
        currency: receivedCredit.currency,
        source_balance: { type: "external" },
        destination_balance: { type: "issuing" },
        status: receivedCredit.status === "succeeded" ? "succeeded" : "pending",
        created: receivedCredit.created
      };
    } else {
      // Production: Use raw API request for beta Balance Transfers endpoint
      // Note: This requires the account to have access to the Balance Transfer API beta
      const response = await stripe.rawRequest("POST", "/v1/balance_transfers", {
        amount,
        currency: "usd",
        "source_balance[type]": "payments",
        "destination_balance[type]": "issuing"
      }, { stripeAccount: connectedAccountId });

      transfer = {
        id: response.id,
        amount: response.amount,
        currency: response.currency,
        source_balance: response.source_balance || { type: "payments" },
        destination_balance: response.destination_balance || { type: "issuing" },
        status: response.status || "succeeded",
        created: response.created
      };
    }

    // Save transaction locally for company-wide transaction history
    if (companyId) {
      try {
        await createBankingTransaction({
          companyId,
          stripeTransactionId: transfer.id,
          stripeAccountId: connectedAccountId,
          type: "fund_card",
          amount: transfer.amount,
          currency: transfer.currency,
          status: transfer.status,
          description: description || "Fund card balance"
        });
      } catch (dbErr) {
        console.error("Error saving fund-card transfer to local DB:", dbErr.message);
        // Don't throw - transfer was created successfully in Stripe
      }
    }

    return {
      id: transfer.id,
      amount: transfer.amount,
      currency: transfer.currency,
      source_balance: transfer.source_balance,
      destination_balance: transfer.destination_balance,
      status: transfer.status,
      created: transfer.created
    };
  } catch (error) {
    console.error("Error funding card balance:", error);
    throw new Error(error.message || "Failed to fund card balance");
  }
};

/**
 * Get balances for Connected Account with dashboard UI data
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} financialAccountId - Stripe Financial Account ID (optional)
 * @returns {object} Account balances formatted for dashboard UI
 */
exports.getBalances = async (connectedAccountId, financialAccountId = null) => {
  try {
    // 1. Get account details (for created date)
    const account = await stripe.accounts.retrieve(connectedAccountId);
    const sinceDate = new Date(account.created * 1000).toISOString().split("T")[0];

    // 2. Get balance
    const accountBalance = await stripe.balance.retrieve({
      stripeAccount: connectedAccountId
    });

    // 3. Get pending transactions count
    const pendingTransactions = await stripe.balanceTransactions.list(
      { limit: 100 },
      { stripeAccount: connectedAccountId }
    );

    // 4. Get external bank account
    const externalAccounts = await stripe.accounts.listExternalAccounts(
      connectedAccountId,
      { object: "bank_account", limit: 1 }
    );

    // Calculate values
    const available = accountBalance.available
      .filter(b => b.currency === "usd")
      .reduce((sum, b) => sum + b.amount, 0);

    const pending = accountBalance.pending
      .filter(b => b.currency === "usd")
      .reduce((sum, b) => sum + b.amount, 0);

    const total = available + pending;
    const availablePercentage = total > 0 ? Math.round((available / total) * 100) : 100;

    // Count pending transactions
    const pendingCount = pendingTransactions.data.filter(t => t.status === "pending").length;

    // External bank
    const bankAccount = externalAccounts.data[0] || null;

    return {
      // Available Balance Card
      availableBalance: {
        amount: available,
        percentage: availablePercentage,
        sinceDate
      },
      // Incoming Transactions Card
      incomingTransactions: {
        count: pendingCount,
        amount: pending
      },
      // Settled Balance Card (Available + Pending = Total received)
      settledBalance: {
        amount: total,
        percentage: 100,
        sinceDate
      },
      // External Bank Account
      externalBankAccount: bankAccount ? {
        id: bankAccount.id,
        last4: bankAccount.last4,
        bankName: bankAccount.bank_name,
        routingNumber: bankAccount.routing_number,
        accountHolderName: bankAccount.account_holder_name,
        currency: bankAccount.currency
      } : null
    };
  } catch (error) {
    console.error("Error getting balances:", error);
    throw new Error(error.message || "Failed to get balances");
  }
};

/**
 * Get payout settings for Connected Account
 * @param {string} connectedAccountId - Stripe connected account ID
 * @returns {object} Payout schedule and instant eligibility
 */
exports.getPayoutSettings = async (connectedAccountId) => {
  try {
    const account = await stripe.accounts.retrieve(connectedAccountId);

    return {
      schedule: account.settings?.payouts?.schedule || { interval: "manual" },
      instantPayouts: {
        eligible: account.capabilities?.instant_payouts === "active",
        fee_percent: 1.5
      }
    };
  } catch (error) {
    console.error("Error getting payout settings:", error);
    throw new Error(error.message || "Failed to get payout settings");
  }
};

/**
 * Update payout schedule for Connected Account
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {object} scheduleData - Schedule configuration
 * @param {string} scheduleData.interval - 'manual' | 'daily' | 'weekly' | 'monthly'
 * @param {number} scheduleData.delay_days - Days to hold before payout (1-14)
 * @param {string} scheduleData.weekly_anchor - Day of week if weekly
 * @returns {object} Updated schedule
 */
exports.updatePayoutSchedule = async (connectedAccountId, scheduleData) => {
  try {
    const { interval, delay_days, weekly_anchor } = scheduleData;

    const schedule = { interval };
    if (delay_days !== undefined) schedule.delay_days = delay_days;
    if (weekly_anchor && interval === "weekly") schedule.weekly_anchor = weekly_anchor;

    const account = await stripe.accounts.update(connectedAccountId, {
      settings: {
        payouts: { schedule }
      }
    });

    return {
      schedule: account.settings.payouts.schedule,
      instantPayouts: {
        eligible: account.capabilities?.instant_payouts === "active",
        fee_percent: 1.5
      }
    };
  } catch (error) {
    console.error("Error updating payout schedule:", error);
    throw new Error(error.message || "Failed to update payout schedule");
  }
};

// ==================== Company-Wide Transactions ====================

/**
 * Get all transactions for a company (invoices + banking transactions)
 * @param {string} companyId - Company MongoDB ID
 * @param {string} companyName - Company name (for recipient field)
 * @param {object} options - Query options
 * @param {string} options.type - Transaction type: 'invoice', 'payout', 'fund_card', 'all'
 * @param {string} options.status - Status filter: 'paid', 'pending', 'failed', 'all'
 * @param {number} options.limit - Max results (default: 20)
 * @param {number} options.page - Page number (default: 1)
 * @param {string} options.startDate - Start date filter (ISO)
 * @param {string} options.endDate - End date filter (ISO)
 * @returns {object} Unified transaction list with pagination
 */
exports.getAllCompanyTransactions = async (companyId, companyName, options = {}) => {
  const {
    type = "all",
    status = "all",
    limit = 20,
    page = 1,
    startDate,
    endDate,
    search
  } = options;

  const skip = (page - 1) * limit;
  const queryOptions = { status, limit, skip, startDate, endDate, search };

  // Import models lazily to avoid circular dependencies
  const {
    findTransactionsByCompany,
    countTransactionsByCompany
  } = require("../../models/invoiceModel");

  const {
    findBankingTransactionsByCompany,
    countBankingTransactionsByCompany
  } = require("../../models/paymentsBankingTransactionModel");

  let invoiceTransactions = [];
  let bankingTransactions = [];
  let invoiceCount = 0;
  let bankingCount = 0;

  // Fetch based on type filter
  if (type === "all" || type === "invoice") {
    // Map status for invoices (paid = paid, pending = open)
    const invoiceStatus = status === "pending" ? "open" : status;
    const invoiceQueryOptions = { ...queryOptions, status: invoiceStatus };

    const [invoices, count] = await Promise.all([
      findTransactionsByCompany(companyId, invoiceQueryOptions),
      countTransactionsByCompany(companyId, { status: invoiceStatus, startDate, endDate, search })
    ]);

    invoiceTransactions = invoices.map(inv => formatInvoiceTransaction(inv, companyName));
    invoiceCount = count;
  }

  if (type === "all" || type === "payout" || type === "fund_card") {
    const bankingType = type === "all" ? "all" : type;
    // Map status for banking (paid = succeeded, pending = pending)
    const bankingStatus = status === "paid" ? "succeeded" : status;
    const bankingQueryOptions = { ...queryOptions, type: bankingType, status: bankingStatus };

    const [banking, count] = await Promise.all([
      findBankingTransactionsByCompany(companyId, bankingQueryOptions),
      countBankingTransactionsByCompany(companyId, { type: bankingType, status: bankingStatus, startDate, endDate, search })
    ]);

    bankingTransactions = banking.map(txn => formatBankingTransactionForDashboard(txn, companyName));
    bankingCount = count;
  }

  // Merge and sort by date
  const allTransactions = [...invoiceTransactions, ...bankingTransactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Apply pagination to merged results
  const paginatedTransactions = allTransactions.slice(0, limit);
  const total = invoiceCount + bankingCount;

  return {
    transactions: paginatedTransactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get all company transactions for CSV export (no pagination)
 * @param {string} companyId - Company ID
 * @param {string} companyName - Company name for display
 * @param {object} options - Filter options
 * @returns {array} All transactions matching filters
 */
exports.getAllCompanyTransactionsForExport = async (companyId, companyName, options = {}) => {
  const {
    type = "all",
    status = "all",
    startDate,
    endDate,
    search
  } = options;

  // High limit to get all transactions
  const queryOptions = { status, limit: 10000, skip: 0, startDate, endDate, search };

  const {
    findTransactionsByCompany
  } = require("../../models/invoiceModel");

  const {
    findBankingTransactionsByCompany
  } = require("../../models/paymentsBankingTransactionModel");

  let invoiceTransactions = [];
  let bankingTransactions = [];

  // Fetch based on type filter
  if (type === "all" || type === "invoice") {
    const invoiceStatus = status === "pending" ? "open" : status;
    const invoiceQueryOptions = { ...queryOptions, status: invoiceStatus };
    const invoices = await findTransactionsByCompany(companyId, invoiceQueryOptions);
    invoiceTransactions = invoices.map(inv => formatInvoiceTransaction(inv, companyName));
  }

  if (type === "all" || type === "payout" || type === "fund_card") {
    const bankingType = type === "all" ? "all" : type;
    const bankingStatus = status === "paid" ? "succeeded" : status;
    const bankingQueryOptions = { ...queryOptions, type: bankingType, status: bankingStatus };
    const banking = await findBankingTransactionsByCompany(companyId, bankingQueryOptions);
    bankingTransactions = banking.map(txn => formatBankingTransactionForDashboard(txn, companyName));
  }

  // Merge and sort by date
  return [...invoiceTransactions, ...bankingTransactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date));
};

/**
 * Format invoice transaction for unified response
 */
function formatInvoiceTransaction(invoice, companyName) {
  // Determine status display
  let displayStatus = "pending";
  if (invoice.status === "paid") displayStatus = "settled";
  else if (invoice.status === "void" || invoice.status === "uncollectible") displayStatus = "failed";

  return {
    id: invoice._id.toString(),
    date: invoice.paidAt || invoice.createdAt,
    amount: invoice.amountDue || 0,
    currency: invoice.currency || "usd",
    sender: invoice.billTo?.name || invoice.billTo?.email || "Unknown",
    recipient: companyName,
    type: "Invoice Payment", // Could be enhanced with payment method detection
    status: displayStatus,
    labels: invoice.labels || [],
    source: "invoice",
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      channelName: invoice.tabId?.name || null,
      clientName: invoice.clientId?.businessName || null,
      paymentIntentId: invoice.paymentIntentId
    }
  };
}

/**
 * Format banking transaction for unified response
 */
function formatBankingTransactionForDashboard(txn, companyName) {
  // Determine status display
  let displayStatus = "pending";
  if (txn.status === "paid" || txn.status === "succeeded") displayStatus = "settled";
  else if (txn.status === "failed" || txn.status === "canceled") displayStatus = "failed";
  else if (txn.status === "in_transit") displayStatus = "pending";

  // Determine type display
  let typeDisplay = "Bank Transfer";
  if (txn.type === "fund_card") typeDisplay = "Card Funding";
  else if (txn.method === "instant") typeDisplay = "Instant Transfer";

  return {
    id: txn._id.toString(),
    date: txn.createdAt,
    amount: txn.amount,
    currency: txn.currency,
    sender: companyName, // Company is sending money out
    recipient: txn.type === "payout"
      ? `Bank ****${txn.destination?.last4 || "****"}`
      : "Virtual Card Balance",
    type: typeDisplay,
    status: displayStatus,
    labels: txn.labels || [],
    source: txn.type,
    metadata: {
      stripeId: txn.stripeTransactionId,
      method: txn.method,
      arrivalDate: txn.arrivalDate,
      bankName: txn.destination?.bankName
    }
  };
}
