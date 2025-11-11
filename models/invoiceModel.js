const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

/**
 * Invoice Schema
 * Hybrid storage model: Core metadata in MongoDB, full invoice data in Stripe
 * Supports both one-time invoices and recurring subscriptions
 */
const invoiceSchema = new Schema({
  // ==================== Stripe References ====================

  stripeInvoiceId: {
    type: String,
    unique: true,
    sparse: true, // Allows null for drafts not yet sent to Stripe
    index: true
  },
  stripeSubscriptionId: {
    type: String,
    index: true
  }, // For recurring invoices only

  // ==================== Relationships ====================

  clientId: {
    type: Types.ObjectId,
    ref: "Client",
    required: true,
    index: true
  },
  tabId: {
    type: Types.ObjectId,
    ref: "ChannelTab",
    required: true,
    index: true
  },
  companyId: {
    type: Types.ObjectId,
    ref: "Company",
    required: true,
    index: true
  },

  // ==================== Invoice Metadata ====================

  invoiceNumber: { type: String }, // Stripe-generated or custom
  status: {
    type: String,
    enum: ['draft', 'open', 'paid', 'void', 'uncollectible'],
    default: 'draft',
    index: true
  },

  // ==================== Financial Details ====================

  currency: { type: String, default: 'usd' },
  amountDue: { type: Number }, // Total amount in cents
  amountPaid: { type: Number, default: 0 }, // Amount paid in cents
  amountRemaining: { type: Number }, // Remaining balance in cents
  subtotal: { type: Number }, // Before tax
  tax: { type: Number }, // Tax amount
  total: { type: Number }, // After tax

  // ==================== Dates ====================

  createdAt: { type: Date, default: Date.now },
  issueDate: { type: Date }, // effective_at in Stripe
  dueDate: { type: Date },
  paidAt: { type: Date },
  voidedAt: { type: Date },

  // ==================== Collection Settings ====================

  collectionMethod: {
    type: String,
    enum: ['charge_automatically', 'send_invoice'],
    default: 'send_invoice'
  },

  // ==================== Invoice Type ====================

  invoiceType: {
    type: String,
    enum: ['one_time', 'recurring'],
    default: 'one_time',
    index: true
  },

  // ==================== Recurring Settings (Subscriptions) ====================

  recurring: {
    interval: {
      type: String,
      enum: ['day', 'week', 'month', 'year']
    },
    intervalCount: { type: Number }, // Every X intervals (e.g., every 2 months)
    endDate: { type: Date }, // Subscription end date
    endAfterCycles: { type: Number }, // Cancel after X billing cycles
    currentCycle: { type: Number, default: 0 }, // Current billing cycle number
    nextBillingDate: { type: Date }, // Next automatic invoice date
    status: {
      type: String,
      enum: ['active', 'canceled', 'paused', 'completed'],
      default: 'active'
    },
    canceledAt: { type: Date },
    pausedAt: { type: Date }
  },

  // ==================== User Tracking ====================

  createdBy: {
    type: Types.ObjectId,
    ref: "User",
    required: true
  },
  sentBy: { type: Types.ObjectId, ref: "User" },
  voidedBy: { type: Types.ObjectId, ref: "User" },

  // ==================== Stripe URLs ====================

  hostedInvoiceUrl: { type: String }, // Client payment page URL
  invoicePdf: { type: String }, // PDF download link

  // ==================== Display Information ====================

  description: { type: String }, // Invoice memo/notes
  footer: { type: String }, // Footer text on invoice

  // Billing contact (optional - overrides customer email for invoice delivery)
  billTo: {
    name: { type: String }, // Billing contact name
    email: { type: String }, // Billing contact email (invoice sent here if provided)
    phone: { type: String } // Billing contact phone (optional)
  },

  // Payment methods accepted for this invoice
  paymentMethods: {
    type: [String],
    enum: ['card', 'us_bank_account', 'customer_balance'],
    default: ['card']
  },

  // Platform fee (application fee for platform revenue)
  platformFee: {
    type: { type: String, enum: ['percentage', 'fixed'] }, // Fee calculation type
    value: { type: Number }, // Fee amount (percentage or cents)
    amount: { type: Number } // Calculated fee amount in cents
  },

  // Line items count (for quick display, full items stored in Stripe)
  lineItemsCount: { type: Number, default: 0 },

  // ==================== Timestamps ====================

  updatedAt: { type: Date, default: Date.now }
});

// Indexes for efficient queries
invoiceSchema.index({ tabId: 1, status: 1 });
invoiceSchema.index({ clientId: 1, status: 1 });
invoiceSchema.index({ companyId: 1, status: 1 });
invoiceSchema.index({ invoiceType: 1, status: 1 });
invoiceSchema.index({ 'recurring.nextBillingDate': 1 }); // For finding upcoming renewals

// Register pagination plugins
invoiceSchema.plugin(mongoosePaginate);
invoiceSchema.plugin(aggregatePaginate);

const InvoiceModel = model("Invoice", invoiceSchema);

// ==================== Utility Functions ====================

/**
 * Create new invoice
 */
exports.createInvoice = (invoiceData) => InvoiceModel.create(invoiceData);

/**
 * Find single invoice
 */
exports.findInvoice = (query) => InvoiceModel.findOne(query);

/**
 * Find invoice by ID
 */
exports.findInvoiceById = (invoiceId) => InvoiceModel.findById(invoiceId);

/**
 * Find multiple invoices
 */
exports.findManyInvoices = (query) => InvoiceModel.find(query);

/**
 * Update invoice
 */
exports.updateInvoice = (query, updateData, options = {}) =>
  InvoiceModel.findOneAndUpdate(query, updateData, { new: true, ...options });

/**
 * Update invoice by ID
 */
exports.updateInvoiceById = (invoiceId, updateData, options = {}) =>
  InvoiceModel.findByIdAndUpdate(invoiceId, updateData, { new: true, ...options });

/**
 * Delete invoice (draft only)
 */
exports.deleteInvoice = (query) => InvoiceModel.findOneAndDelete(query);

/**
 * Delete invoice by ID
 */
exports.deleteInvoiceById = (invoiceId) => InvoiceModel.findByIdAndDelete(invoiceId);

/**
 * Get all invoices with pagination
 */
exports.getAllInvoices = async ({
  query,
  page,
  limit,
  sort = { createdAt: -1 },
  responseKey = "invoices",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: InvoiceModel,
    query,
    page,
    limit,
    sort,
  });

  return { [responseKey]: data, pagination };
};

/**
 * Update invoice status
 */
exports.updateInvoiceStatus = async (invoiceId, status, additionalData = {}) => {
  const updateData = {
    status,
    updatedAt: new Date(),
    ...additionalData
  };

  // Set timestamps based on status
  if (status === 'paid' && !additionalData.paidAt) {
    updateData.paidAt = new Date();
  }
  if (status === 'void' && !additionalData.voidedAt) {
    updateData.voidedAt = new Date();
  }

  return InvoiceModel.findByIdAndUpdate(
    invoiceId,
    { $set: updateData },
    { new: true }
  );
};

/**
 * Update subscription status
 */
exports.updateSubscriptionStatus = async (invoiceId, subscriptionStatus, additionalData = {}) => {
  const updateData = {
    'recurring.status': subscriptionStatus,
    updatedAt: new Date(),
    ...additionalData
  };

  // Set timestamps based on subscription status
  if (subscriptionStatus === 'canceled' && !additionalData['recurring.canceledAt']) {
    updateData['recurring.canceledAt'] = new Date();
  }
  if (subscriptionStatus === 'paused' && !additionalData['recurring.pausedAt']) {
    updateData['recurring.pausedAt'] = new Date();
  }

  return InvoiceModel.findByIdAndUpdate(
    invoiceId,
    { $set: updateData },
    { new: true }
  );
};

/**
 * Increment subscription cycle count
 */
exports.incrementSubscriptionCycle = async (invoiceId, nextBillingDate) => {
  return InvoiceModel.findByIdAndUpdate(
    invoiceId,
    {
      $inc: { 'recurring.currentCycle': 1 },
      $set: {
        'recurring.nextBillingDate': nextBillingDate,
        updatedAt: new Date()
      }
    },
    { new: true }
  );
};

/**
 * Find invoices by tab
 */
exports.findInvoicesByTab = async (tabId, options = {}) => {
  const { status, invoiceType, limit, skip } = options;

  const query = { tabId };
  if (status) query.status = status;
  if (invoiceType) query.invoiceType = invoiceType;

  let queryBuilder = InvoiceModel.find(query).sort({ createdAt: -1 });

  if (limit) queryBuilder = queryBuilder.limit(limit);
  if (skip) queryBuilder = queryBuilder.skip(skip);

  return queryBuilder.exec();
};

/**
 * Find invoices by client
 */
exports.findInvoicesByClient = async (clientId, options = {}) => {
  const { status, invoiceType, limit, skip } = options;

  const query = { clientId };
  if (status) query.status = status;
  if (invoiceType) query.invoiceType = invoiceType;

  let queryBuilder = InvoiceModel.find(query).sort({ createdAt: -1 });

  if (limit) queryBuilder = queryBuilder.limit(limit);
  if (skip) queryBuilder = queryBuilder.skip(skip);

  return queryBuilder.exec();
};

/**
 * Find upcoming subscription renewals
 * Used for automated billing reminders
 */
exports.findUpcomingRenewals = async (daysAhead = 7) => {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);

  return InvoiceModel.find({
    invoiceType: 'recurring',
    'recurring.status': 'active',
    'recurring.nextBillingDate': {
      $gte: now,
      $lte: futureDate
    }
  });
};

/**
 * Count invoices by status
 */
exports.countInvoicesByStatus = async (tabId, status) => {
  return InvoiceModel.countDocuments({ tabId, status });
};

/**
 * Get invoice statistics for tab
 */
exports.getInvoiceStats = async (tabId) => {
  const stats = await InvoiceModel.aggregate([
    { $match: { tabId: Types.ObjectId(tabId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amountDue' }
      }
    }
  ]);

  return stats;
};

// Export the model
exports.InvoiceModel = InvoiceModel;
