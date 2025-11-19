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

    // If TOS acceptance is being updated, capture IP and timestamp automatically
    if (updates.tos_acceptance) {
      updates.tos_acceptance = {
        ...updates.tos_acceptance,
        date: updates.tos_acceptance.date || Math.floor(Date.now() / 1000),
        ip: updates.tos_acceptance.ip || req.ip || req.connection.remoteAddress,
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

      // Invoice events
      case "invoice.created":
        {
          const invoice = event.data.object;
          console.log(`Invoice created by Stripe: ${invoice.id}`);

          // Check if this invoice belongs to a subscription
          if (invoice.subscription) {
            const {
              findInvoice,
              createInvoice,
              getSubscriptionInvoices
            } = require("../../models/invoiceModel");

            // Check if invoice already exists in MongoDB
            const existingInvoice = await findInvoice({ stripeInvoiceId: invoice.id });

            if (!existingInvoice) {
              console.log(`Auto-creating invoice record for subscription: ${invoice.subscription}`);

              // Find an existing invoice for this subscription to get metadata
              const subscriptionInvoices = await getSubscriptionInvoices(invoice.subscription);

              if (subscriptionInvoices.length > 0) {
                // Use first invoice as template for metadata
                const templateInvoice = subscriptionInvoices[0];

                // Determine the billing cycle number
                const billingCycleNumber = subscriptionInvoices.length + 1;

                // Create new invoice record for this billing cycle
                const invoiceData = {
                  stripeInvoiceId: invoice.id,
                  stripeSubscriptionId: invoice.subscription,
                  clientId: templateInvoice.clientId,
                  tabId: templateInvoice.tabId,
                  companyId: templateInvoice.companyId,
                  status: invoice.status || 'draft',
                  currency: invoice.currency,
                  amountDue: invoice.amount_due,
                  amountPaid: invoice.amount_paid || 0,
                  amountRemaining: invoice.amount_remaining,
                  subtotal: invoice.subtotal,
                  tax: invoice.tax,
                  total: invoice.total,
                  collectionMethod: invoice.collection_method,
                  invoiceType: 'recurring',
                  billingCycleNumber,
                  recurring: templateInvoice.recurring, // Copy recurring config
                  description: templateInvoice.description,
                  billTo: templateInvoice.billTo,
                  paymentMethods: templateInvoice.paymentMethods,
                  platformFee: templateInvoice.platformFee,
                  lineItemsCount: invoice.lines?.data?.length || 0,
                  createdBy: templateInvoice.createdBy,
                  hostedInvoiceUrl: invoice.hosted_invoice_url,
                  invoicePdf: invoice.invoice_pdf
                };

                const newInvoice = await createInvoice(invoiceData);
                console.log(`Created invoice record ${newInvoice._id} for billing cycle ${billingCycleNumber}`);

                // Update client to add this invoice reference
                const { updateClient } = require("../../models/clientModel");
                await updateClient(
                  { _id: templateInvoice.clientId },
                  { $push: { "stripe.invoices": newInvoice._id } }
                );
              } else {
                console.warn(`No template invoice found for subscription ${invoice.subscription}. First invoice should be created via API.`);
              }
            } else {
              console.log(`Invoice ${invoice.id} already exists in MongoDB (created via API)`);
            }
          } else {
            console.log(`Invoice ${invoice.id} is not part of a subscription, skipping auto-creation`);
          }
        }
        break;

      case "invoice.paid":
        {
          const invoice = event.data.object;
          console.log(`Invoice paid: ${invoice.id}, amount: ${invoice.amount_paid}`);

          // Find invoice in MongoDB by Stripe invoice ID
          const { findInvoice, updateInvoiceStatus } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeInvoiceId: invoice.id });

          if (invoiceRecord) {
            // Update status using MongoDB _id and mark as attempted
            await updateInvoiceStatus(
              invoiceRecord._id,
              'paid',
              {
                amountPaid: invoice.amount_paid,
                amountRemaining: 0,
                paidAt: new Date(invoice.status_transitions.paid_at * 1000),
                // Track payment attempt (successfully paid)
                attempted: true,
                attemptCount: invoice.attempt_count || 1,
                paymentIntentId: invoice.payment_intent || invoiceRecord.paymentIntentId
              }
            );

            // Create activity
            const { createInvoicePaidActivity } = require("../../controller/helpers/invoices/invoiceActivityHelpers");
            await createInvoicePaidActivity({
              tabId: invoiceRecord.tabId,
              invoiceId: invoiceRecord._id,
              invoiceNumber: invoice.number,
              amount: invoice.amount_paid,
              currency: invoice.currency
            });

            console.log(`Invoice ${invoice.id} marked as attempted (paid successfully)`);
          } else {
            console.warn(`Invoice not found in MongoDB: ${invoice.id}`);
          }
        }
        break;

      case "invoice.payment_failed":
        {
          const invoice = event.data.object;
          console.log(`Invoice payment failed: ${invoice.id}, attempt: ${invoice.attempt_count}`);

          // Create activity for payment failure and update payment attempt tracking
          const { findInvoice, updateInvoice } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeInvoiceId: invoice.id });

          if (invoiceRecord) {
            // Mark invoice as attempted and update attempt count
            await updateInvoice(
              { stripeInvoiceId: invoice.id },
              {
                attempted: true, // Payment was attempted (failed)
                attemptCount: invoice.attempt_count || 1,
                paymentIntentId: invoice.payment_intent || invoiceRecord.paymentIntentId
              }
            );

            const { createInvoicePaymentFailedActivity } = require("../../controller/helpers/invoices/invoiceActivityHelpers");
            await createInvoicePaymentFailedActivity({
              tabId: invoiceRecord.tabId,
              invoiceId: invoiceRecord._id,
              invoiceNumber: invoice.number,
              amount: invoice.amount_due,
              currency: invoice.currency,
              attemptCount: invoice.attempt_count
            });

            console.log(`Invoice ${invoice.id} marked as attempted (failed) - attempt #${invoice.attempt_count}`);
          }
        }
        break;

      case "invoice.payment_action_required":
        {
          const invoice = event.data.object;
          console.log(`Invoice payment action required (3D Secure): ${invoice.id}`);

          // Find invoice, update payment attempt tracking, and create activity
          const { findInvoice, updateInvoice } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeInvoiceId: invoice.id });

          if (invoiceRecord) {
            // Mark invoice as attempted (customer initiated payment, waiting for 3D Secure)
            await updateInvoice(
              { stripeInvoiceId: invoice.id },
              {
                attempted: true, // Customer started payment process
                attemptCount: invoice.attempt_count || 1,
                paymentIntentId: invoice.payment_intent || invoiceRecord.paymentIntentId
              }
            );

            const { createActivity } = require("../../models/activityModel");
            await createActivity({
              tabId: invoiceRecord.tabId,
              type: 'invoice_payment_action_required',
              message: `Payment requires customer authentication for invoice ${invoice.number}`,
              metadata: {
                invoiceId: invoiceRecord._id,
                invoiceNumber: invoice.number,
                actionType: '3d_secure'
              }
            });

            console.log(`Invoice ${invoice.id} marked as attempted (action required)`);
          }
        }
        break;

      case "payment_intent.payment_failed":
        {
          const paymentIntent = event.data.object;
          console.log(`PaymentIntent failed: ${paymentIntent.id}, next retry: ${paymentIntent.next_action?.type || 'none'}`);

          // Log payment failure for monitoring Smart Retries
          // Note: This event fires before invoice.payment_failed
          // Smart Retries will automatically schedule the next attempt
        }
        break;

      case "invoice.finalized":
        {
          const invoice = event.data.object;
          console.log(`Invoice finalized: ${invoice.id}`);

          // Update invoice status in MongoDB
          const { findInvoice, updateInvoice } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeInvoiceId: invoice.id });

          if (invoiceRecord) {
            // Update both draft invoices and subscription invoices
            const updateData = {
              status: 'open',
              invoiceNumber: invoice.number,
              hostedInvoiceUrl: invoice.hosted_invoice_url,
              invoicePdf: invoice.invoice_pdf,
              amountDue: invoice.amount_due,
              amountRemaining: invoice.amount_remaining,
              subtotal: invoice.subtotal,
              tax: invoice.tax,
              total: invoice.total,
              // Track payment attempt status
              attempted: invoice.attempted || false,
              attemptCount: invoice.attempt_count || 0,
              paymentIntentId: invoice.payment_intent || null
            };

            // Add issue date if available
            if (invoice.effective_at) {
              updateData.issueDate = new Date(invoice.effective_at * 1000);
            }

            // Add due date if available
            if (invoice.due_date) {
              updateData.dueDate = new Date(invoice.due_date * 1000);
            }

            await updateInvoice(
              { stripeInvoiceId: invoice.id },
              updateData
            );

            console.log(`Invoice ${invoice.id} finalized and updated in MongoDB (attempted: ${updateData.attempted})`);
          } else {
            console.warn(`Invoice ${invoice.id} not found in MongoDB during finalize`);
          }
        }
        break;

      case "invoice.sent":
        console.log(`Invoice sent: ${event.data.object.id}`);
        break;

      case "invoice.voided":
        {
          const invoice = event.data.object;
          console.log(`Invoice voided: ${invoice.id}`);

          // Find invoice in MongoDB by Stripe invoice ID
          const { findInvoice, updateInvoiceStatus } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeInvoiceId: invoice.id });

          if (invoiceRecord) {
            // Update status using MongoDB _id
            await updateInvoiceStatus(invoiceRecord._id, 'void', {
              voidedAt: new Date()
            });
          } else {
            console.warn(`Invoice not found in MongoDB: ${invoice.id}`);
          }
        }
        break;

      case "invoice.marked_uncollectible":
        {
          const invoice = event.data.object;
          console.log(`Invoice marked uncollectible: ${invoice.id}`);

          // Find invoice in MongoDB by Stripe invoice ID
          const { findInvoice, updateInvoiceStatus } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeInvoiceId: invoice.id });

          if (invoiceRecord) {
            // Update status using MongoDB _id
            await updateInvoiceStatus(invoiceRecord._id, 'uncollectible');
          } else {
            console.warn(`Invoice not found in MongoDB: ${invoice.id}`);
          }
        }
        break;

      // Subscription events
      case "customer.subscription.created":
      case "customer.subscription.updated":
        {
          const subscription = event.data.object;
          console.log(`Subscription ${event.type}: ${subscription.id}, status: ${subscription.status}`);

          // Update subscription status in MongoDB
          const { findInvoice, updateSubscriptionStatus } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeSubscriptionId: subscription.id });

          if (invoiceRecord) {
            const statusMap = {
              'active': 'active',
              'past_due': 'active',
              'canceled': 'canceled',
              'unpaid': 'paused'
            };

            // Build update data, only including nextBillingDate if current_period_end is available
            const updateData = {};
            if (subscription.current_period_end) {
              updateData['recurring.nextBillingDate'] = new Date(subscription.current_period_end * 1000);
            }

            await updateSubscriptionStatus(
              invoiceRecord._id,
              statusMap[subscription.status] || 'active',
              updateData
            );
          }
        }
        break;

      case "customer.subscription.deleted":
        {
          const subscription = event.data.object;
          console.log(`Subscription deleted: ${subscription.id}`);

          // Update subscription status in MongoDB
          const { findInvoice, updateSubscriptionStatus } = require("../../models/invoiceModel");
          const invoiceRecord = await findInvoice({ stripeSubscriptionId: subscription.id });

          if (invoiceRecord) {
            await updateSubscriptionStatus(
              invoiceRecord._id,
              'canceled',
              {
                'recurring.canceledAt': new Date()
              }
            );
          }
        }
        break;

      // ==================== Issuing Authorization Events ====================

      case "issuing_authorization.created":
        {
          const authorization = event.data.object;
          console.log(`Issuing authorization created: ${authorization.id} for ${authorization.amount/100} ${authorization.currency.toUpperCase()} at ${authorization.merchant_data?.name || 'Unknown'}`);

          // Log authorization details for audit trail
          console.log(`Authorization status: ${authorization.approved ? 'APPROVED' : 'DECLINED'}`);
          console.log(`Card: ${authorization.card.id} (last4: ${authorization.card.last4})`);
          console.log(`Merchant: ${authorization.merchant_data?.name} (${authorization.merchant_data?.city}, ${authorization.merchant_data?.country})`);

          // Future enhancement: Store authorization in separate model for detailed tracking
        }
        break;

      case "issuing_authorization.updated":
        {
          const authorization = event.data.object;
          console.log(`Issuing authorization updated: ${authorization.id} - Status: ${authorization.status}`);
          console.log(`Authorization amount: ${authorization.amount/100} ${authorization.currency.toUpperCase()}`);

          // Log status changes for monitoring
          if (authorization.status === 'closed') {
            console.log(`Authorization closed - transactions: ${authorization.transactions.length}`);
          }
        }
        break;

      // ==================== Issuing Transaction Events ====================

      case "issuing_transaction.created":
        {
          const transaction = event.data.object;
          const type = transaction.type === "capture" ? "PURCHASE" : "REFUND";
          console.log(`Issuing transaction created: ${transaction.id} - ${type} ${transaction.amount/100} ${transaction.currency.toUpperCase()}`);
          console.log(`Card: ${transaction.card} | Merchant: ${transaction.merchant_data?.name || 'Unknown'}`);

          // Transaction is already tracked via Issuing API in transactions endpoint
          // This webhook provides real-time notification
        }
        break;

      case "issuing_transaction.updated":
        {
          const transaction = event.data.object;
          console.log(`Issuing transaction updated: ${transaction.id} - Amount: ${transaction.amount/100} ${transaction.currency.toUpperCase()}`);

          // Log transaction updates for monitoring
          if (transaction.dispute) {
            console.log(`Transaction disputed: ${transaction.id}`);
          }
        }
        break;

      // ==================== Issuing Card Events ====================

      case "issuing_card.updated":
        {
          const card = event.data.object;
          console.log(`Issuing card updated: ${card.id} (last4: ${card.last4}) - Status: ${card.status}`);

          // Sync card status with MongoDB
          const { findCardByStripeId, updateCard } = require("../../models/paymentsIssuedCardModel");
          const cardRecord = await findCardByStripeId(card.id);

          if (cardRecord) {
            await updateCard({ stripeCardId: card.id }, {
              status: card.status,
              cancellationReason: card.cancellation_reason || cardRecord.cancellationReason,
              spendingControls: card.spending_controls || cardRecord.spendingControls,
              updatedAt: new Date()
            });
            console.log(`Updated card record in database: ${card.id}`);
          } else {
            console.warn(`Card not found in database: ${card.id}`);
          }
        }
        break;

      // ==================== Issuing Cardholder Events ====================

      case "issuing_cardholder.updated":
        {
          const cardholder = event.data.object;
          console.log(`Issuing cardholder updated: ${cardholder.id} - Status: ${cardholder.status}`);

          // Sync cardholder status with MongoDB
          const { findCardholderByStripeId, updateCardholder } = require("../../models/paymentsCardholderModel");
          const cardholderRecord = await findCardholderByStripeId(cardholder.id);

          if (cardholderRecord) {
            await updateCardholder({ stripeCardholderId: cardholder.id }, {
              status: cardholder.status,
              email: cardholder.email || cardholderRecord.email,
              phoneNumber: cardholder.phone_number || cardholderRecord.phoneNumber,
              billing: cardholder.billing || cardholderRecord.billing,
              updatedAt: new Date()
            });
            console.log(`Updated cardholder record in database: ${cardholder.id}`);
          } else {
            console.warn(`Cardholder not found in database: ${cardholder.id}`);
          }
        }
        break;

      // ==================== Treasury Financial Account Events ====================

      case "treasury.financial_account.updated":
        {
          const account = event.data.object;
          console.log(`Treasury Financial Account updated: ${account.id} - Status: ${account.status}`);
          console.log(`Balance: ${Object.entries(account.balance.cash).map(([curr, amt]) => `${amt/100} ${curr.toUpperCase()}`).join(', ')}`);

          // Sync Financial Account balance and status with MongoDB
          const { findFinancialAccountByStripeId, updateFinancialAccount } = require("../../models/paymentsFinancialAccountModel");
          const faRecord = await findFinancialAccountByStripeId(account.id);

          if (faRecord) {
            await updateFinancialAccount({ stripeFinancialAccountId: account.id }, {
              status: account.status,
              'balance.cash': account.balance.cash,
              'balance.inbound_pending': account.balance.inbound_pending,
              'balance.outbound_pending': account.balance.outbound_pending,
              updatedAt: new Date()
            });
            console.log(`Updated Financial Account balance in database: ${account.id}`);
          } else {
            console.warn(`Financial Account not found in database: ${account.id}`);
          }
        }
        break;

      case "treasury.financial_account.features_status_updated":
        {
          const account = event.data.object;
          console.log(`Treasury Financial Account features updated: ${account.id}`);

          // Log feature status changes
          if (account.features) {
            const activeFeatures = [];
            if (account.features.card_issuing?.status === 'active') activeFeatures.push('card_issuing');
            if (account.features.deposit_insurance?.status === 'active') activeFeatures.push('deposit_insurance');
            if (account.features.financial_addresses?.aba?.status === 'active') activeFeatures.push('aba');
            if (account.features.inbound_transfers?.ach?.status === 'active') activeFeatures.push('inbound_ach');
            if (account.features.outbound_transfers?.ach?.status === 'active') activeFeatures.push('outbound_ach');
            console.log(`Active features: ${activeFeatures.join(', ')}`);
          }

          // Sync features with MongoDB
          const { findFinancialAccountByStripeId, updateFinancialAccount } = require("../../models/paymentsFinancialAccountModel");
          const faRecord = await findFinancialAccountByStripeId(account.id);

          if (faRecord) {
            await updateFinancialAccount({ stripeFinancialAccountId: account.id }, {
              features: account.features,
              updatedAt: new Date()
            });
            console.log(`Updated Financial Account features in database: ${account.id}`);
          }
        }
        break;

      // ==================== Treasury Transaction Events ====================

      case "treasury.received_credit.created":
        {
          const credit = event.data.object;
          console.log(`Treasury received credit: ${credit.id} - ${credit.amount/100} ${credit.currency.toUpperCase()} via ${credit.network}`);
          console.log(`Financial Account: ${credit.financial_account} | Status: ${credit.status}`);
          console.log(`Description: ${credit.description || 'No description'}`);

          // Credit is already tracked via Treasury API in transactions endpoint
          // This webhook provides real-time notification for balance updates
        }
        break;

      case "treasury.received_debit.created":
        {
          const debit = event.data.object;
          console.log(`Treasury received debit: ${debit.id} - ${debit.amount/100} ${debit.currency.toUpperCase()} via ${debit.network}`);
          console.log(`Financial Account: ${debit.financial_account} | Status: ${debit.status}`);
          console.log(`Description: ${debit.description || 'No description'}`);

          // Debit is already tracked via Treasury API in transactions endpoint
          // This webhook provides real-time notification for balance updates
        }
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

/**
 * Get requirements list with human-readable labels
 * GET /api/payments/connect/accounts/:companyId/requirements?status=active|completed
 */
exports.getRequirementsList = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { status } = req.query;
    const userId = req.user.id;

    console.log(`Fetching ${status} requirements list for company: ${companyId}`);

    // Validate status parameter
    if (!status || !["active", "completed"].includes(status)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Query parameter 'status' is required and must be either 'active' or 'completed'",
      });
    }

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

    const result = await stripeService.getRequirementsList(companyId, status);

    return generateResponse(
      {
        status: result.status,
        count: result.count,
        requirements: result.requirements,
      },
      `${status === "active" ? "Active" : "Completed"} requirements retrieved successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getRequirementsList controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company. Please complete onboarding first.",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch requirements list",
    });
  }
};

/**
 * Set attestation that all persons have been provided
 * POST /api/payments/connect/accounts/:companyId/persons-provided
 */
exports.setPersonsProvided = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.id;
    const attestations = req.validatedBody;

    console.log(`Setting persons provided for company: ${companyId}`);

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

    const result = await stripeService.setPersonsProvided(companyId, attestations);

    return generateResponse(
      {
        accountId: result.accountId,
        attestations: result.attestations,
      },
      "Persons provided attestation set successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in setPersonsProvided controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to set persons provided attestation",
    });
  }
};

/**
 * Fix email settings for connected account
 * POST /api/payments/connect/accounts/:companyId/fix-email-settings
 * Required for invoice email delivery
 */
exports.fixAccountEmailSettings = async (req, res, next) => {
  try {
    const { companyId } = req.params;

    console.log(`Fixing email settings for company: ${companyId}`);

    const result = await stripeService.fixAccountEmailSettings(companyId);

    return generateResponse(
      {
        displayName: result.displayName,
        businessName: result.businessName,
      },
      result.message,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in fixAccountEmailSettings controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fix email settings",
    });
  }
};

/**
 * Get list of Stripe-supported countries
 * GET /api/payments/countries
 */
exports.getCountries = async (req, res, next) => {
  try {
    console.log("Fetching list of supported countries");

    const result = await stripeService.getCountrySpecs();

    return generateResponse(
      {
        countries: result.countries,
      },
      "Countries retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getCountries controller:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch countries",
    });
  }
};
