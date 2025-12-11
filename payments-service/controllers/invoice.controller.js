"use strict";

const { generateResponse, parseBody } = require("../../utils");
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
  findInvoiceById,
  updateInvoice,
  updateInvoiceById,
  updateInvoiceStatus,
  deleteInvoiceById,
  findInvoicesByTab,
  findInvoicesByClient
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
  // Find connected account
  const accountRecord = await findAccountByCompany(companyId);
  if (!accountRecord) {
    throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
  }

  // Get account details from Stripe
  const stripeAccount = await stripeService.getAccount(accountRecord.stripeAccountId);

  // Check if onboarding is complete
  if (!stripeAccount.details_submitted) {
    throw new Error("ONBOARDING_INCOMPLETE");
  }

  // Check if account can accept charges
  if (!stripeAccount.charges_enabled) {
    throw new Error("CHARGES_NOT_ENABLED");
  }

  // Check for pending requirements
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
 * Create one-time invoice
 * POST /api/payments/clients/:tabId/invoices
 * Body: { collectionMethod, dueDate, description, footer, currency, lineItems, autoSend }
 */
exports.createInvoice = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;
    const {
      collectionMethod,
      dueDate,
      daysUntilDue,
      description,
      footer,
      currency,
      lineItems,
      autoSend,
      enableAutomaticTax,
      customerAddress,
      billTo,
      paymentMethods,
      platformFee,
      recurring // NEW: Check if this is a recurring invoice
    } = req.body;

    console.log(`Creating ${recurring ? 'recurring' : 'one-time'} invoice for tab: ${tabId}`);

    // Validate tab access
    const tab = await validateTabAccess(tabId, userId);

    // Get client and company
    const client = await getClientAndCompany(tabId);
    const companyId = client.companyId;

    // Validate prerequisites
    const accountRecord = await validatePrerequisites(companyId);

    // Ensure client has Stripe customer
    if (!client.stripe?.customerId) {
      throw new Error("CLIENT_NO_STRIPE_CUSTOMER");
    }

    const customerId = client.stripe.customerId;
    const connectedAccountId = accountRecord.stripeAccountId;

    // Update customer address if provided (required for automatic tax)
    if (customerAddress) {
      console.log(`Updating customer address for tax calculation`);
      await stripeService.updateCustomerAddress(companyId, customerId, customerAddress);
    }

    // Get default payment method if using auto-charge
    let defaultPaymentMethod = null;
    if (collectionMethod === 'charge_automatically') {
      defaultPaymentMethod = client.stripe.defaultPaymentMethod;

      // Validate payment method for automatic charging
      if (!defaultPaymentMethod) {
        throw new Error("NO_DEFAULT_PAYMENT_METHOD");
      }
    }

    let stripeInvoiceId;
    let stripeSubscriptionId = null;
    let amountDue;
    let lineItemsCount;
    let platformFeeData = null;

    // BRANCH: Handle recurring vs one-time invoices
    if (recurring) {
      // ===== RECURRING INVOICE (SUBSCRIPTION) FLOW =====
      console.log(`Creating subscription with recurring settings: ${recurring.interval}/${recurring.intervalCount}`);

      // Create subscription with line items
      const subscriptionResult = await stripeService.createSubscriptionWithLineItems({
        customerId,
        connectedAccountId,
        lineItems,
        currency,
        interval: recurring.interval,
        intervalCount: recurring.intervalCount,
        collectionMethod,
        daysUntilDue,
        endDate: recurring.endDate,
        endAfterCycles: recurring.endAfterCycles,
        description,
        defaultPaymentMethod,
        paymentMethods,
        platformFee
      });

      stripeSubscriptionId = subscriptionResult.subscription.id;

      // Get the first invoice from the subscription
      const latestInvoice = subscriptionResult.subscription.latestInvoice;
      stripeInvoiceId = typeof latestInvoice === 'string' ? latestInvoice : latestInvoice?.id;

      if (!stripeInvoiceId) {
        throw new Error("Failed to retrieve first invoice from subscription");
      }

      // Fetch full invoice details from Stripe
      const invoiceDetails = await stripeService.getInvoice({
        invoiceId: stripeInvoiceId,
        connectedAccountId
      });
      amountDue = invoiceDetails.invoice.amountDue;
      lineItemsCount = invoiceDetails.invoice.lines?.data?.length || lineItems.length;

      // Calculate platform fee if provided
      if (platformFee) {
        if (platformFee.type === 'percentage') {
          const feeAmount = Math.round(amountDue * (platformFee.value / 100));
          platformFeeData = {
            type: platformFee.type,
            value: platformFee.value,
            amount: feeAmount
          };
        } else if (platformFee.type === 'fixed') {
          platformFeeData = {
            type: platformFee.type,
            value: platformFee.value,
            amount: platformFee.value
          };
        }
      }
    } else {
      // ===== ONE-TIME INVOICE FLOW (EXISTING) =====
      // Create draft invoice in Stripe
      const invoiceResult = await stripeService.createInvoice({
        customerId,
        connectedAccountId,
        collectionMethod,
        dueDate,
        daysUntilDue,
        description,
        footer,
        currency,
        enableAutomaticTax,
        defaultPaymentMethod,
        paymentMethods,
        platformFee
      });

      stripeInvoiceId = invoiceResult.invoice.id;

      // Add line items
      const lineItemsResult = await stripeService.addInvoiceLineItems({
        invoiceId: stripeInvoiceId,
        connectedAccountId,
        lineItems
      });

      // Calculate totals
      amountDue = lineItemsResult.invoice.amountDue;
      lineItemsCount = lineItemsResult.invoice.lineItemsCount;

      // Apply platform fee if provided
      if (platformFee) {
        const platformFeeResult = await stripeService.applyPlatformFee({
          invoiceId: stripeInvoiceId,
          connectedAccountId,
          platformFee,
          invoiceAmount: amountDue
        });

        platformFeeData = {
          type: platformFee.type,
          value: platformFee.value,
          amount: platformFeeResult.feeAmount
        };

        // Update amount due after fee application
        amountDue = platformFeeResult.invoice.amountDue;
      }
    }

    // Save invoice metadata to MongoDB
    const invoiceData = {
      stripeInvoiceId,
      clientId: client._id,
      tabId,
      companyId,
      status: recurring ? 'open' : 'draft', // Subscriptions create open invoices immediately
      currency: currency || 'usd',
      amountDue,
      amountRemaining: amountDue,
      dueDate: dueDate ? new Date(dueDate) : null,
      collectionMethod,
      invoiceType: recurring ? 'recurring' : 'one_time',
      description,
      footer,
      lineItemsCount,
      createdBy: userId
    };

    // Add subscription ID and recurring settings if this is a recurring invoice
    if (recurring) {
      invoiceData.stripeSubscriptionId = stripeSubscriptionId;
      invoiceData.billingCycleNumber = 1; // This is the first invoice
      invoiceData.recurring = {
        interval: recurring.interval,
        intervalCount: recurring.intervalCount || 1,
        endDate: recurring.endDate || null,
        endAfterCycles: recurring.endAfterCycles || null,
        currentCycle: 1,
        status: 'active'
      };
    }

    // Add billing contact if provided
    if (billTo) {
      console.log(`Invoice will be sent to billing contact: ${billTo.email}`);
      invoiceData.billTo = billTo;
    }

    // Add payment methods if provided
    if (paymentMethods) {
      invoiceData.paymentMethods = paymentMethods;
    }

    // Add platform fee data if calculated
    if (platformFeeData) {
      invoiceData.platformFee = platformFeeData;
    }

    const invoiceRecord = await createInvoice(invoiceData);

    // Add invoice reference to client and subscription reference if recurring
    const clientUpdate = { $push: { "stripe.invoices": invoiceRecord._id } };
    if (recurring && stripeSubscriptionId) {
      clientUpdate.$push["stripe.subscriptions"] = {
        subscriptionId: stripeSubscriptionId,
        invoiceId: invoiceRecord._id,
        status: 'active'
      };
    }
    await updateClient({ _id: client._id }, clientUpdate);

    // Initialize finalResult based on invoice type
    let finalResult = null;
    if (recurring) {
      // For recurring invoices, fetch the invoice details from Stripe
      const invoiceDetails = await stripeService.getInvoice({
        invoiceId: stripeInvoiceId,
        connectedAccountId
      });
      finalResult = invoiceDetails.invoice;
    } else {
      // For one-time invoices, use the result from creation
      const invoiceResult = await stripeService.getInvoice({
        invoiceId: stripeInvoiceId,
        connectedAccountId
      });
      finalResult = invoiceResult.invoice;
    }

    // If autoSend is true, finalize and send (only for one-time invoices)
    // Recurring invoices are automatically finalized by Stripe
    if (autoSend && !recurring) {
      // Finalize invoice (updates customer email if billTo provided)
      const finalizeResult = await stripeService.finalizeInvoice({
        invoiceId: stripeInvoiceId,
        connectedAccountId,
        autoAdvance: false,
        customerEmail: billTo?.email // Use custom billing email if provided
      });

      // Send invoice (customer email already updated during finalize)
      const sendResult = await stripeService.sendInvoice({
        invoiceId: stripeInvoiceId,
        connectedAccountId
      });

      // Update invoice status in MongoDB
      await updateInvoiceById(invoiceRecord._id, {
        status: 'open',
        invoiceNumber: finalizeResult.invoice.number,
        hostedInvoiceUrl: finalizeResult.invoice.hostedInvoiceUrl,
        invoicePdf: finalizeResult.invoice.invoicePdf,
        sentBy: userId
      });

      finalResult = sendResult.invoice;

      // Create activity for sent invoice
      await createInvoiceActivity({
        type: ACTION_TYPE.SEND_INVOICE,
        tabId,
        userId,
        invoiceId: invoiceRecord._id,
        metadata: {
          invoiceNumber: finalizeResult.invoice.number,
          amount: amountDue,
          currency: currency || 'usd'
        }
      });
    }

    // For recurring invoices, update the invoice number and URLs from Stripe
    if (recurring) {
      await updateInvoiceById(invoiceRecord._id, {
        invoiceNumber: finalResult.number,
        hostedInvoiceUrl: finalResult.hostedInvoiceUrl,
        invoicePdf: finalResult.invoicePdf
      });
    }

    // Create activity for invoice creation
    await createInvoiceActivity({
      type: ACTION_TYPE.CREATE_INVOICE,
      tabId,
      userId,
      invoiceId: invoiceRecord._id,
      metadata: {
        amount: amountDue,
        currency: currency || 'usd',
        lineItemsCount,
        autoSent: autoSend || false
      }
    });

    console.log(`Invoice created successfully: ${invoiceRecord._id}`);

    // Build response
    const response = {
      invoice: {
        id: invoiceRecord._id,
        stripeInvoiceId,
        invoiceType: recurring ? 'recurring' : 'one_time',
        status: recurring ? 'open' : (autoSend ? 'open' : 'draft'),
        amountDue,
        currency: currency || 'usd',
        dueDate: invoiceRecord.dueDate,
        lineItemsCount,
        hostedInvoiceUrl: finalResult?.hostedInvoiceUrl,
        invoicePdf: finalResult?.invoicePdf,
        invoiceNumber: finalResult?.number
      }
    };

    // Add subscription info for recurring invoices
    if (recurring) {
      response.invoice.stripeSubscriptionId = stripeSubscriptionId;
      response.invoice.billingCycleNumber = 1;
      response.invoice.recurring = {
        interval: recurring.interval,
        intervalCount: recurring.intervalCount || 1,
        endDate: recurring.endDate || null,
        endAfterCycles: recurring.endAfterCycles || null,
        status: 'active'
      };
    }

    const successMessage = recurring
      ? "Recurring invoice created successfully (subscription active)"
      : autoSend
      ? "Invoice created and sent successfully"
      : "Invoice created as draft";

    return generateResponse(
      response,
      successMessage,
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error creating invoice:", error);

    const errorMessages = {
      "TAB_NOT_FOUND": "Channel tab not found",
      "FORBIDDEN": "You don't have access to this tab",
      "CLIENT_NOT_FOUND": "Client not found for this tab",
      "CLIENT_NO_COMPANY": "Client is not associated with a company",
      "STRIPE_ACCOUNT_NOT_FOUND": "Stripe account not found for this company",
      "ONBOARDING_INCOMPLETE": "Stripe account onboarding is not complete",
      "CHARGES_NOT_ENABLED": "Stripe account cannot accept payments yet",
      "CLIENT_NO_STRIPE_CUSTOMER": "Client does not have a Stripe customer account. Please collect payment method first.",
      "NO_DEFAULT_PAYMENT_METHOD": "Cannot charge automatically without a saved payment method. Please add a payment method for this client first."
    };

    const message = errorMessages[error.message] || error.message || "Failed to create invoice";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Update draft invoice
 * PUT /api/payments/clients/:tabId/invoices/:invoiceId
 * Body: { description, footer, dueDate, daysUntilDue }
 */
exports.updateInvoice = async (req, res, next) => {
  try {
    const { tabId, invoiceId } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    console.log(`Updating invoice: ${invoiceId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    // Check invoice belongs to tab
    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    // Only draft invoices can be updated
    if (invoice.status !== 'draft') {
      throw new Error("INVOICE_NOT_DRAFT");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Update customer address if provided (required for automatic tax)
    if (updates.customerAddress) {
      console.log(`Updating customer address for tax calculation`);
      const client = await findClient({ tabId });
      if (client?.stripe?.customerId) {
        await stripeService.updateCustomerAddress(
          invoice.companyId,
          client.stripe.customerId,
          updates.customerAddress
        );
      }
    }

    // Prepare Stripe updates
    const stripeUpdates = {};
    if (updates.description !== undefined) stripeUpdates.description = updates.description;
    if (updates.footer !== undefined) stripeUpdates.footer = updates.footer;
    if (updates.dueDate) {
      stripeUpdates.due_date = Math.floor(new Date(updates.dueDate).getTime() / 1000);
    }
    if (updates.daysUntilDue !== undefined) {
      stripeUpdates.days_until_due = updates.daysUntilDue;
    }

    // Update in Stripe
    await stripeService.updateInvoice({
      invoiceId: invoice.stripeInvoiceId,
      connectedAccountId,
      updates: stripeUpdates
    });

    // Update in MongoDB
    const mongoUpdates = {};
    if (updates.description !== undefined) mongoUpdates.description = updates.description;
    if (updates.footer !== undefined) mongoUpdates.footer = updates.footer;
    if (updates.dueDate) mongoUpdates.dueDate = new Date(updates.dueDate);
    if (updates.billTo !== undefined) mongoUpdates.billTo = updates.billTo;

    const updatedInvoice = await updateInvoiceById(invoiceId, mongoUpdates);

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.UPDATE_INVOICE,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: { updates }
    });

    console.log(`Invoice updated successfully: ${invoiceId}`);

    return generateResponse(
      {
        invoice: {
          id: updatedInvoice._id,
          status: updatedInvoice.status,
          description: updatedInvoice.description,
          footer: updatedInvoice.footer,
          dueDate: updatedInvoice.dueDate
        }
      },
      "Invoice updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error updating invoice:", error);

    const errorMessages = {
      "TAB_NOT_FOUND": "Channel tab not found",
      "FORBIDDEN": "You don't have access to this invoice",
      "INVOICE_NOT_FOUND": "Invoice not found",
      "INVOICE_NOT_DRAFT": "Only draft invoices can be updated"
    };

    const message = errorMessages[error.message] || error.message || "Failed to update invoice";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Finalize invoice (draft → open)
 * POST /api/payments/clients/:tabId/invoices/:invoiceId/finalize
 */
exports.finalizeInvoice = async (req, res, next) => {
  try {
    const { tabId, invoiceId } = req.params;
    const userId = req.user.id;

    console.log(`Finalizing invoice: ${invoiceId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.status !== 'draft') {
      throw new Error("INVOICE_ALREADY_FINALIZED");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Get the Stripe invoice to check if automatic tax is enabled
    const stripeInvoice = await stripeService.getInvoice({
      invoiceId: invoice.stripeInvoiceId,
      connectedAccountId
    });

    // If automatic tax is enabled, verify customer has address
    if (stripeInvoice.invoice.automatic_tax?.enabled) {
      const client = await findClient({ tabId });
      if (client?.stripe?.customerId) {
        const stripeCustomer = await stripeService.getCustomer({
          customerId: client.stripe.customerId,
          connectedAccountId
        });

        // Check if customer has required address fields
        const hasAddress = stripeCustomer.customer.address?.country &&
                          stripeCustomer.customer.address?.postal_code;

        if (!hasAddress) {
          throw new Error("CUSTOMER_ADDRESS_REQUIRED");
        }
      }
    }

    // Finalize in Stripe
    const result = await stripeService.finalizeInvoice({
      invoiceId: invoice.stripeInvoiceId,
      connectedAccountId,
      autoAdvance: false,
      customerEmail: invoice.billTo?.email // Use custom billing email if provided
    });

    // Update in MongoDB
    const updatedInvoice = await updateInvoiceById(invoiceId, {
      status: 'open',
      invoiceNumber: result.invoice.number,
      hostedInvoiceUrl: result.invoice.hostedInvoiceUrl,
      invoicePdf: result.invoice.invoicePdf,
      amountDue: result.invoice.amountDue
    });

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.FINALIZE_INVOICE,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        invoiceNumber: result.invoice.number,
        amount: result.invoice.amountDue
      }
    });

    console.log(`Invoice finalized: ${invoiceId}`);

    return generateResponse(
      {
        invoice: {
          id: updatedInvoice._id,
          status: 'open',
          invoiceNumber: updatedInvoice.invoiceNumber,
          hostedInvoiceUrl: updatedInvoice.hostedInvoiceUrl,
          invoicePdf: updatedInvoice.invoicePdf
        }
      },
      "Invoice finalized successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error finalizing invoice:", error);

    const errorMessages = {
      "INVOICE_NOT_FOUND": "Invoice not found",
      "FORBIDDEN": "You don't have access to this invoice",
      "INVOICE_ALREADY_FINALIZED": "Invoice is already finalized",
      "CUSTOMER_ADDRESS_REQUIRED": "Customer address is required for automatic tax calculation. Please update the invoice with customer address before finalizing."
    };

    const message = errorMessages[error.message] || error.message || "Failed to finalize invoice";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Send invoice email
 * POST /api/payments/clients/:tabId/invoices/:invoiceId/send
 */
exports.sendInvoice = async (req, res, next) => {
  try {
    const { tabId, invoiceId } = req.params;
    const userId = req.user.id;

    console.log(`Sending invoice: ${invoiceId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.status !== 'open') {
      throw new Error("INVOICE_NOT_OPEN");
    }

    // Ensure billing email exists
    if (!invoice.billTo?.email) {
      throw new Error("NO_BILLING_EMAIL");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    console.log(`Sending invoice ${invoice.invoiceNumber} to: ${invoice.billTo.email}`);
    console.log(`Note: Customer email was already updated during finalize to: ${invoice.billTo.email}`);

    // Send invoice (customer email already updated during finalize)
    await stripeService.sendInvoice({
      invoiceId: invoice.stripeInvoiceId,
      connectedAccountId
    });

    // Update sentBy
    await updateInvoiceById(invoiceId, { sentBy: userId });

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.SEND_INVOICE,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amountDue
      }
    });

    console.log(`Invoice sent: ${invoiceId} to ${invoice.billTo.email}`);

    return generateResponse(
      {
        invoice: {
          id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          sentTo: invoice.billTo.email
        }
      },
      "Invoice sent successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error sending invoice:", error);

    const errorMessages = {
      "INVOICE_NOT_FOUND": "Invoice not found",
      "FORBIDDEN": "You don't have access to this invoice",
      "INVOICE_NOT_OPEN": "Only finalized invoices can be sent",
      "NO_BILLING_EMAIL": "No billing email address provided. Please add a billTo email when creating the invoice."
    };

    const message = errorMessages[error.message] || error.message || "Failed to send invoice";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Void invoice
 * POST /api/payments/clients/:tabId/invoices/:invoiceId/void
 */
exports.voidInvoice = async (req, res, next) => {
  try {
    const { tabId, invoiceId } = req.params;
    const userId = req.user.id;

    console.log(`Voiding invoice: ${invoiceId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.status === 'void') {
      throw new Error("INVOICE_ALREADY_VOID");
    }

    if (invoice.status === 'paid') {
      throw new Error("CANNOT_VOID_PAID_INVOICE");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Void in Stripe
    await stripeService.voidInvoice({
      invoiceId: invoice.stripeInvoiceId,
      connectedAccountId
    });

    // Update in MongoDB
    await updateInvoiceById(invoiceId, {
      status: 'void',
      voidedAt: new Date(),
      voidedBy: userId
    });

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.VOID_INVOICE,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber
      }
    });

    console.log(`Invoice voided: ${invoiceId}`);

    return generateResponse(
      {
        invoice: {
          id: invoice._id,
          status: 'void'
        }
      },
      "Invoice voided successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error voiding invoice:", error);

    const errorMessages = {
      "INVOICE_NOT_FOUND": "Invoice not found",
      "FORBIDDEN": "You don't have access to this invoice",
      "INVOICE_ALREADY_VOID": "Invoice is already voided",
      "CANNOT_VOID_PAID_INVOICE": "Cannot void a paid invoice"
    };

    const message = errorMessages[error.message] || error.message || "Failed to void invoice";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Get invoice details
 * GET /api/payments/clients/:tabId/invoices/:invoiceId
 */
exports.getInvoice = async (req, res, next) => {
  try {
    const { tabId, invoiceId } = req.params;
    const userId = req.user.id;

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice in MongoDB
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    // Get full details from Stripe
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    const stripeInvoice = await stripeService.getInvoice({
      invoiceId: invoice.stripeInvoiceId,
      connectedAccountId
    });

    return generateResponse(
      {
        invoice: {
          // MongoDB data
          id: invoice._id,
          status: invoice.status,
          invoiceType: invoice.invoiceType,
          createdAt: invoice.createdAt,

          // Stripe data
          ...stripeInvoice.invoice
        }
      },
      "Invoice retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error retrieving invoice:", error);

    const errorMessages = {
      "INVOICE_NOT_FOUND": "Invoice not found",
      "FORBIDDEN": "You don't have access to this invoice"
    };

    const message = errorMessages[error.message] || error.message || "Failed to retrieve invoice";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * List invoices for client
 * GET /api/payments/clients/:tabId/invoices
 * Query: ?status=draft|open|paid|void&limit=10&page=1
 */
exports.listInvoices = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;
    const { status, limit = 10, page = 1, days = 60 } = req.query;

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client
    const client = await findClient({ tabId });
    if (!client) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    // Find invoices
    const skip = (page - 1) * limit;
    const { countInvoicesByTab, getInvoiceSummaryStats } = require("../../models/invoiceModel");

    const [invoices, totalCount, summary] = await Promise.all([
      findInvoicesByTab(tabId, {
        status,
        limit: parseInt(limit),
        skip
      }),
      countInvoicesByTab(tabId, status),
      getInvoiceSummaryStats(tabId, parseInt(days))
    ]);

    // Get connected account for fetching payment details
    const accountRecord = await findAccountByCompany(client.companyId);
    const connectedAccountId = accountRecord?.stripeAccountId;

    // Fetch payment details for paid invoices
    const invoicesWithDetails = await Promise.all(
      invoices.map(async (inv) => {
        const invoiceData = {
          id: inv._id,
          stripeInvoiceId: inv.stripeInvoiceId,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          invoiceType: inv.invoiceType,
          amountDue: inv.amountDue,
          amountPaid: inv.amountPaid,
          currency: inv.currency,
          dueDate: inv.dueDate,
          createdAt: inv.createdAt,
          hostedInvoiceUrl: inv.hostedInvoiceUrl,
          sentTo: inv.billTo?.email || null
        };

        // Add payment method details for paid invoices
        if (inv.status === 'paid' && inv.stripeInvoiceId && connectedAccountId) {
          try {
            const paymentDetails = await stripeService.getInvoicePaymentDetails(
              inv.stripeInvoiceId,
              connectedAccountId
            );
            invoiceData.paymentMethod = paymentDetails || null;
          } catch (error) {
            console.error(`Error fetching payment details for invoice ${inv._id}:`, error);
            invoiceData.paymentMethod = null;
          }
        } else {
          // Unpaid invoices have null payment method for consistent response structure
          invoiceData.paymentMethod = null;
        }

        return invoiceData;
      })
    );

    return generateResponse(
      {
        invoices: invoicesWithDetails,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        },
        summary
      },
      "Invoices retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error listing invoices:", error);

    const message = error.message || "Failed to list invoices";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Get transactions (invoices where payment was attempted)
 * GET /api/payments/clients/:tabId/transactions
 */
exports.getTransactions = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const userId = req.user.id;
    const { status, limit = 10, page = 1 } = req.query;

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Get client
    const client = await findClient({ tabId });
    if (!client) {
      throw new Error("CLIENT_NOT_FOUND");
    }

    // Find transactions (invoices where payment was attempted)
    const skip = (page - 1) * limit;
    const { findTransactionsByTab, countTransactionsByTab } = require("../../models/invoiceModel");

    const transactions = await findTransactionsByTab(tabId, {
      status,
      limit: parseInt(limit),
      skip
    });

    const totalCount = await countTransactionsByTab(tabId, status);

    // Get connected account for fetching payment details
    const accountRecord = await findAccountByCompany(client.companyId);
    const connectedAccountId = accountRecord?.stripeAccountId;

    // Enrich transactions with payment details
    const transactionsWithDetails = await Promise.all(
      transactions.map(async (inv) => {
        const transactionData = {
          id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          stripeInvoiceId: inv.stripeInvoiceId,
          amount: inv.amountDue,
          currency: inv.currency,
          status: inv.status,
          date: inv.paidAt || inv.createdAt, // Use paidAt if available, otherwise createdAt
          customerEmail: inv.billTo?.email || null,
          description: inv.paymentIntentId || inv.stripeInvoiceId, // Payment Intent ID (the "long numbers")
          attemptCount: inv.attemptCount || 0,
          hostedInvoiceUrl: inv.hostedInvoiceUrl,
          invoicePdf: inv.invoicePdf
        };

        // Add payment method details if invoice was paid
        if (inv.status === 'paid' && inv.stripeInvoiceId && connectedAccountId) {
          try {
            const paymentDetails = await stripeService.getInvoicePaymentDetails(
              inv.stripeInvoiceId,
              connectedAccountId
            );
            transactionData.paymentMethod = paymentDetails || null;
          } catch (error) {
            console.error(`Error fetching payment details for transaction ${inv._id}:`, error);
            transactionData.paymentMethod = null;
          }
        } else {
          transactionData.paymentMethod = null;
        }

        return transactionData;
      })
    );

    return generateResponse(
      {
        transactions: transactionsWithDetails,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        }
      },
      "Transactions retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error retrieving transactions:", error);

    const message = error.message || "Failed to retrieve transactions";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};

/**
 * Delete draft invoice
 * DELETE /api/payments/clients/:tabId/invoices/:invoiceId
 */
exports.deleteInvoice = async (req, res, next) => {
  try {
    const { tabId, invoiceId } = req.params;
    const userId = req.user.id;

    console.log(`Deleting invoice: ${invoiceId}`);

    // Validate tab access
    await validateTabAccess(tabId, userId);

    // Find invoice
    const invoice = await findInvoiceById(invoiceId);
    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    if (invoice.tabId.toString() !== tabId) {
      throw new Error("FORBIDDEN");
    }

    if (invoice.status !== 'draft') {
      throw new Error("ONLY_DRAFT_CAN_DELETE");
    }

    // Get connected account
    const accountRecord = await findAccountByCompany(invoice.companyId);
    const connectedAccountId = accountRecord.stripeAccountId;

    // Delete from Stripe
    await stripeService.deleteInvoice({
      invoiceId: invoice.stripeInvoiceId,
      connectedAccountId
    });

    // Delete from MongoDB
    await deleteInvoiceById(invoiceId);

    // Remove from client's invoice list
    const client = await findClient({ tabId });
    await updateClient(
      { _id: client._id },
      { $pull: { "stripe.invoices": invoiceId } }
    );

    // Create activity
    await createInvoiceActivity({
      type: ACTION_TYPE.DELETE_INVOICE,
      tabId,
      userId,
      invoiceId: invoice._id,
      metadata: {
        amount: invoice.amountDue
      }
    });

    console.log(`Invoice deleted: ${invoiceId}`);

    return generateResponse(
      { deleted: true },
      "Invoice deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error deleting invoice:", error);

    const errorMessages = {
      "INVOICE_NOT_FOUND": "Invoice not found",
      "FORBIDDEN": "You don't have access to this invoice",
      "ONLY_DRAFT_CAN_DELETE": "Only draft invoices can be deleted"
    };

    const message = errorMessages[error.message] || error.message || "Failed to delete invoice";

    return generateResponse(
      { error: message },
      message,
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }
};
