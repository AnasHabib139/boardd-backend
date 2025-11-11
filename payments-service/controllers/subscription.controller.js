"use strict";

const { generateResponse } = require("../../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../../utils/constants");
const stripeService = require("../services/stripe.service");
const {
  findClient,
  updateClient
} = require("../../models/clientModel");
const { findChannelTab } = require("../../models/channelTabsModel");
const { findAccountByCompany } = require("../models/PaymentsStripeAccount");
const {
  createInvoice,
  findInvoice,
  updateInvoice,
  updateSubscriptionStatus,
  incrementSubscriptionCycle
} = require("../../models/invoiceModel");
const {
  createInvoiceActivity
} = require("../../controller/helpers/invoices/invoiceActivityHelpers");

/**
 * Helper function to validate tab access
 */
async function validateTabAccess(tabId, userId) {
  const tab = await findChannelTab({ _id: tabId });
  if (!tab) {
    throw new Error("TAB_NOT_FOUND");
  }

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

  if (!client.companyId) {
    const tab = await findChannelTab({ _id: tabId });
    if (!tab || !tab.companyId) {
      throw new Error("CLIENT_NO_COMPANY");
    }

    const updatedClient = await updateClient(
      { _id: client._id },
      { companyId: tab.companyId }
    );

    console.log(`Auto-fixed: Set companyId for client ${client._id}`);
    return updatedClient;
  }

  return client;
}

/**
 * Helper function to validate prerequisites
 */
async function validatePrerequisites(companyId) {
  const accountRecord = await findAccountByCompany(companyId);
  if (!accountRecord) {
    throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
  }

  const stripeAccount = await stripeService.getAccount(accountRecord.stripeAccountId);

  if (!stripeAccount.details_submitted) {
    throw new Error("ONBOARDING_INCOMPLETE");
  }

  if (!stripeAccount.charges_enabled) {
    throw new Error("CHARGES_NOT_ENABLED");
  }

  if (
    stripeAccount.requirements?.currently_due &&
    stripeAccount.requirements.currently_due.length > 0
  ) {
    throw new Error(
      `Stripe account has pending requirements: ${stripeAccount.requirements.currently_due.join(", ")}. Please complete account setup first.`
    );
  }

  return accountRecord;
}

/**
 * Create recurring subscription
 * POST /api/payments/clients/:tabId/subscriptions
 * Body: { amount, currency, interval, intervalCount, collectionMethod, endDate, endAfterCycles, description }
 */
exports.createSubscription = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;
    const {
      amount,
      currency,
      interval,
      intervalCount,
      collectionMethod,
      endDate,
      endAfterCycles,
      description,
      paymentMethods,
      platformFee
    } = req.body;

    console.log(`Creating subscription for tab: ${tabId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client and company
    const client = await getClientAndCompany(tabId);
    const companyId = client.companyId;

    // Validate prerequisites
    const accountRecord = await validatePrerequisites(companyId);

    // Ensure client has Stripe customer
    if (!client.stripe?.customerId) {
      throw new Error("CLIENT_NO_STRIPE_CUSTOMER");
    }

    // For charge_automatically, ensure client has default payment method
    if (collectionMethod === 'charge_automatically' && !client.stripe.defaultPaymentMethod) {
      throw new Error("NO_DEFAULT_PAYMENT_METHOD");
    }

    const customerId = client.stripe.customerId;
    const connectedAccountId = accountRecord.stripeAccountId;
    const defaultPaymentMethod = client.stripe.defaultPaymentMethod;

    // Create subscription in Stripe
    const result = await stripeService.createSubscription({
      customerId,
      connectedAccountId,
      unitAmount: amount,
      currency,
      interval,
      intervalCount,
      collectionMethod,
      endDate,
      endAfterCycles,
      description,
      defaultPaymentMethod,
      paymentMethods,
      platformFee
    });

    // Calculate next billing date
    const nextBillingDate = new Date(result.subscription.currentPeriodEnd * 1000);

    // Save invoice record to MongoDB (for recurring subscription)
    const invoiceData = {
      stripeSubscriptionId: result.subscription.id,
      stripeInvoiceId: result.subscription.latestInvoiceId,
      clientId: client._id,
      tabId,
      companyId,
      status: 'open', // First invoice is immediately created
      currency: currency || 'usd',
      collectionMethod,
      invoiceType: 'recurring',
      description,
      recurring: {
        interval,
        intervalCount,
        endDate: endDate ? new Date(endDate) : null,
        endAfterCycles,
        currentCycle: 1,
        nextBillingDate,
        status: 'active'
      },
      createdBy: userId
    };

    // Add payment methods if provided
    if (paymentMethods) {
      invoiceData.paymentMethods = paymentMethods;
    }

    // Add platform fee data if provided
    if (platformFee) {
      // Calculate fee amount from subscription amount
      let feeAmount;
      if (platformFee.type === 'percentage') {
        feeAmount = Math.round((amount * platformFee.value) / 100);
      } else {
        feeAmount = platformFee.value;
      }

      invoiceData.platformFee = {
        type: platformFee.type,
        value: platformFee.value,
        amount: feeAmount
      };
    }

    const invoiceRecord = await createInvoice(invoiceData);

    // Add subscription reference to client
    await updateClient(
      { _id: client._id },
      {
        $push: {
          "stripe.subscriptions": {
            subscriptionId: result.subscription.id,
            invoiceId: invoiceRecord._id,
            status: 'active'
          },
          "stripe.invoices": invoiceRecord._id
        }
      }
    );

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.CREATE_SUBSCRIPTION,
      tabId,
      userId,
      invoiceId: invoiceRecord._id,
      metadata: {
        subscriptionId: result.subscription.id,
        amount,
        currency: currency || 'usd',
        interval,
        intervalCount
      }
    });

    console.log(`Subscription created successfully: ${result.subscription.id}`);

    return generateResponse(
      {
        subscription: {
          id: invoiceRecord._id,
          stripeSubscriptionId: result.subscription.id,
          status: 'active',
          amount,
          currency: currency || 'usd',
          interval,
          intervalCount,
          currentPeriodEnd: result.subscription.currentPeriodEnd,
          nextBillingDate,
          latestInvoiceId: result.subscription.latestInvoiceId
        }
      },
      "Subscription created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error creating subscription:", error);

    const errorMessages = {
      "TAB_NOT_FOUND": "Channel tab not found",
      "FORBIDDEN": "You don't have access to this tab",
      "CLIENT_NOT_FOUND": "Client not found for this tab",
      "CLIENT_NO_COMPANY": "Client is not associated with a company",
      "STRIPE_ACCOUNT_NOT_FOUND": "Stripe account not found for this company",
      "ONBOARDING_INCOMPLETE": "Stripe account onboarding is not complete",
      "CHARGES_NOT_ENABLED": "Stripe account cannot accept payments yet",
      "CLIENT_NO_STRIPE_CUSTOMER": "Client does not have a Stripe customer account",
      "NO_DEFAULT_PAYMENT_METHOD": "Client must have a default payment method for automatic charging"
    };

    const message = errorMessages[error.message] || error.message || "Failed to create subscription";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Update subscription
 * PUT /api/payments/clients/:tabId/subscriptions/:subscriptionId
 * Body: { amount, description, endDate, endAfterCycles }
 */
exports.updateSubscription = async (req, res, next) => {
  try {
    const { tabId, subscriptionId } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    console.log(`Updating subscription: ${subscriptionId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice record
    const invoice = await findInvoice({
      _id: subscriptionId,
      invoiceType: 'recurring'
    });

    if (!invoice) {
      throw new Error("SUBSCRIPTION_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.recurring.status !== 'active') {
      throw new Error("SUBSCRIPTION_NOT_ACTIVE");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Prepare Stripe updates
    const stripeUpdates = {};
    if (updates.description) stripeUpdates.description = updates.description;
    if (updates.endDate) {
      stripeUpdates.cancel_at = Math.floor(new Date(updates.endDate).getTime() / 1000);
    }
    if (updates.endAfterCycles) {
      stripeUpdates.cancel_after = updates.endAfterCycles;
    }

    // Update in Stripe
    await stripeService.updateSubscription({
      subscriptionId: invoice.stripeSubscriptionId,
      connectedAccountId,
      updates: stripeUpdates
    });

    // Update in MongoDB
    const mongoUpdates = {};
    if (updates.description) mongoUpdates.description = updates.description;
    if (updates.endDate) mongoUpdates['recurring.endDate'] = new Date(updates.endDate);
    if (updates.endAfterCycles) mongoUpdates['recurring.endAfterCycles'] = updates.endAfterCycles;

    const updatedInvoice = await updateInvoice(
      { _id: subscriptionId },
      mongoUpdates
    );

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.UPDATE_SUBSCRIPTION,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        subscriptionId: invoice.stripeSubscriptionId,
        updates
      }
    });

    console.log(`Subscription updated successfully: ${subscriptionId}`);

    return generateResponse(
      {
        subscription: {
          id: updatedInvoice._id,
          status: updatedInvoice.recurring.status,
          description: updatedInvoice.description
        }
      },
      "Subscription updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error updating subscription:", error);

    const errorMessages = {
      "SUBSCRIPTION_NOT_FOUND": "Subscription not found",
      "FORBIDDEN": "You don't have access to this subscription",
      "SUBSCRIPTION_NOT_ACTIVE": "Only active subscriptions can be updated"
    };

    const message = errorMessages[error.message] || error.message || "Failed to update subscription";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Cancel subscription
 * POST /api/payments/clients/:tabId/subscriptions/:subscriptionId/cancel
 * Body: { cancelAtPeriodEnd }
 */
exports.cancelSubscription = async (req, res, next) => {
  try {
    const { tabId, subscriptionId } = req.params;
    const userId = req.user.id;
    const { cancelAtPeriodEnd } = req.body;

    console.log(`Canceling subscription: ${subscriptionId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice record
    const invoice = await findInvoice({
      _id: subscriptionId,
      invoiceType: 'recurring'
    });

    if (!invoice) {
      throw new Error("SUBSCRIPTION_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.recurring.status === 'canceled') {
      throw new Error("SUBSCRIPTION_ALREADY_CANCELED");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Cancel in Stripe
    await stripeService.cancelSubscription({
      subscriptionId: invoice.stripeSubscriptionId,
      connectedAccountId,
      cancelAtPeriodEnd
    });

    // Update in MongoDB
    await updateSubscriptionStatus(
      subscriptionId,
      'canceled',
      {
        'recurring.canceledAt': new Date()
      }
    );

    // Update client's subscription status
    const client = await findClient({ tabId });
    await updateClient(
      {
        _id: client._id,
        "stripe.subscriptions.subscriptionId": invoice.stripeSubscriptionId
      },
      {
        $set: { "stripe.subscriptions.$.status": "canceled" }
      }
    );

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.CANCEL_SUBSCRIPTION,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        subscriptionId: invoice.stripeSubscriptionId,
        cancelAtPeriodEnd
      }
    });

    console.log(`Subscription canceled: ${subscriptionId}`);

    return generateResponse(
      {
        subscription: {
          id: invoice._id,
          status: 'canceled',
          cancelAtPeriodEnd
        }
      },
      cancelAtPeriodEnd ?
        "Subscription will be canceled at end of billing period" :
        "Subscription canceled immediately",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error canceling subscription:", error);

    const errorMessages = {
      "SUBSCRIPTION_NOT_FOUND": "Subscription not found",
      "FORBIDDEN": "You don't have access to this subscription",
      "SUBSCRIPTION_ALREADY_CANCELED": "Subscription is already canceled"
    };

    const message = errorMessages[error.message] || error.message || "Failed to cancel subscription";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Pause subscription
 * POST /api/payments/clients/:tabId/subscriptions/:subscriptionId/pause
 */
exports.pauseSubscription = async (req, res, next) => {
  try {
    const { tabId, subscriptionId } = req.params;
    const userId = req.user.id;

    console.log(`Pausing subscription: ${subscriptionId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice record
    const invoice = await findInvoice({
      _id: subscriptionId,
      invoiceType: 'recurring'
    });

    if (!invoice) {
      throw new Error("SUBSCRIPTION_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.recurring.status !== 'active') {
      throw new Error("SUBSCRIPTION_NOT_ACTIVE");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Pause in Stripe
    await stripeService.pauseSubscription({
      subscriptionId: invoice.stripeSubscriptionId,
      connectedAccountId
    });

    // Update in MongoDB
    await updateSubscriptionStatus(
      subscriptionId,
      'paused',
      {
        'recurring.pausedAt': new Date()
      }
    );

    // Update client's subscription status
    const client = await findClient({ tabId });
    await updateClient(
      {
        _id: client._id,
        "stripe.subscriptions.subscriptionId": invoice.stripeSubscriptionId
      },
      {
        $set: { "stripe.subscriptions.$.status": "paused" }
      }
    );

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.PAUSE_SUBSCRIPTION,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        subscriptionId: invoice.stripeSubscriptionId
      }
    });

    console.log(`Subscription paused: ${subscriptionId}`);

    return generateResponse(
      {
        subscription: {
          id: invoice._id,
          status: 'paused'
        }
      },
      "Subscription paused successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error pausing subscription:", error);

    const errorMessages = {
      "SUBSCRIPTION_NOT_FOUND": "Subscription not found",
      "FORBIDDEN": "You don't have access to this subscription",
      "SUBSCRIPTION_NOT_ACTIVE": "Only active subscriptions can be paused"
    };

    const message = errorMessages[error.message] || error.message || "Failed to pause subscription";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Resume paused subscription
 * POST /api/payments/clients/:tabId/subscriptions/:subscriptionId/resume
 */
exports.resumeSubscription = async (req, res, next) => {
  try {
    const { tabId, subscriptionId } = req.params;
    const userId = req.user.id;

    console.log(`Resuming subscription: ${subscriptionId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice record
    const invoice = await findInvoice({
      _id: subscriptionId,
      invoiceType: 'recurring'
    });

    if (!invoice) {
      throw new Error("SUBSCRIPTION_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.recurring.status !== 'paused') {
      throw new Error("SUBSCRIPTION_NOT_PAUSED");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Resume in Stripe
    await stripeService.resumeSubscription({
      subscriptionId: invoice.stripeSubscriptionId,
      connectedAccountId
    });

    // Update in MongoDB
    await updateSubscriptionStatus(
      subscriptionId,
      'active',
      {
        'recurring.pausedAt': null
      }
    );

    // Update client's subscription status
    const client = await findClient({ tabId });
    await updateClient(
      {
        _id: client._id,
        "stripe.subscriptions.subscriptionId": invoice.stripeSubscriptionId
      },
      {
        $set: { "stripe.subscriptions.$.status": "active" }
      }
    );

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.RESUME_SUBSCRIPTION,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        subscriptionId: invoice.stripeSubscriptionId
      }
    });

    console.log(`Subscription resumed: ${subscriptionId}`);

    return generateResponse(
      {
        subscription: {
          id: invoice._id,
          status: 'active'
        }
      },
      "Subscription resumed successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error resuming subscription:", error);

    const errorMessages = {
      "SUBSCRIPTION_NOT_FOUND": "Subscription not found",
      "FORBIDDEN": "You don't have access to this subscription",
      "SUBSCRIPTION_NOT_PAUSED": "Only paused subscriptions can be resumed"
    };

    const message = errorMessages[error.message] || error.message || "Failed to resume subscription";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * List subscriptions for client
 * GET /api/payments/clients/:tabId/subscriptions
 */
exports.listSubscriptions = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;
    const { status } = req.query;

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client
    const client = await findClient({ tabId });
    if (!client) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    // Find subscriptions (invoices with invoiceType = 'recurring')
    const { findInvoicesByTab } = require("../../models/invoiceModel");
    const subscriptions = await findInvoicesByTab(tabId, {
      invoiceType: 'recurring',
      ...(status && { 'recurring.status': status })
    });

    return generateResponse(
      {
        subscriptions: subscriptions.map(sub => ({
          id: sub._id,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          status: sub.recurring.status,
          amount: sub.amountDue,
          currency: sub.currency,
          interval: sub.recurring.interval,
          intervalCount: sub.recurring.intervalCount,
          currentCycle: sub.recurring.currentCycle,
          nextBillingDate: sub.recurring.nextBillingDate,
          endDate: sub.recurring.endDate,
          endAfterCycles: sub.recurring.endAfterCycles,
          createdAt: sub.createdAt
        }))
      },
      "Subscriptions retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error listing subscriptions:", error);

    const message = error.message || "Failed to list subscriptions";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};
