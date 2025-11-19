"use strict";

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
 * Issue virtual card for cardholder
 * @param {string} connectedAccountId - Stripe connected account ID
 * @param {string} cardholderId - Stripe cardholder ID
 * @param {object} cardData - Card details
 * @param {string} cardData.currency - Card currency (default: "usd")
 * @param {string} cardData.financialAccountId - Financial Account ID (required for platforms)
 * @returns {object} Created card
 */
exports.issueCard = async (connectedAccountId, cardholderId, cardData = {}) => {
  try {
    const { currency = "usd", financialAccountId } = cardData;

    // Create virtual card
    const card = await stripe.issuing.cards.create(
      {
        cardholder: cardholderId,
        currency,
        type: "virtual",
        status: "active",
        financial_account: financialAccountId
        // No spending_controls = unlimited spending
      },
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
      status: card.status
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
