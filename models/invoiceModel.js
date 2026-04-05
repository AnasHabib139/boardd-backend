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

  // Billing cycle number for this specific invoice (1, 2, 3, etc.)
  // Only set for recurring invoices - indicates which billing cycle this invoice represents
  billingCycleNumber: {
    type: Number,
    index: true
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

  // ==================== Custom Labels ====================

  labels: {
    type: [String],
    default: []
  },

  // ==================== Payment Attempt Tracking ====================

  // Whether a payment attempt was made (customer clicked "Pay Now")
  attempted: {
    type: Boolean,
    default: false,
    index: true // For efficient transaction queries
  },

  // Number of payment retry attempts
  attemptCount: {
    type: Number,
    default: 0
  },

  // Stripe Payment Intent ID (the "transaction ID" - long format like pi_xxx...)
  paymentIntentId: {
    type: String,
    index: true
  },

  // ==================== Timestamps ====================

  updatedAt: { type: Date, default: Date.now }
});

// Indexes for efficient queries
invoiceSchema.index({ tabId: 1, status: 1 });
invoiceSchema.index({ clientId: 1, status: 1 });
invoiceSchema.index({ companyId: 1, status: 1 });
invoiceSchema.index({ invoiceType: 1, status: 1 });
invoiceSchema.index({ 'recurring.nextBillingDate': 1 }); // For finding upcoming renewals
invoiceSchema.index({ tabId: 1, attempted: 1 }); // For transaction queries
invoiceSchema.index({ clientId: 1, attempted: 1 }); // For transaction queries
invoiceSchema.index({ companyId: 1, attempted: 1, createdAt: -1 }); // For company-wide transaction queries

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

  let queryBuilder = InvoiceModel.find(query)
    .populate("createdBy", "name completeName image")
    .sort({ createdAt: -1 });

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

/**
 * Get all invoices for a subscription
 * Returns all billing cycle invoices sorted by cycle number
 */
exports.getSubscriptionInvoices = async (stripeSubscriptionId) => {
  return InvoiceModel.find({
    stripeSubscriptionId,
    invoiceType: 'recurring'
  })
    .sort({ billingCycleNumber: 1 })
    .exec();
};

/**
 * Find invoice by subscription and cycle number
 */
exports.findInvoiceBySubscriptionCycle = async (stripeSubscriptionId, billingCycleNumber) => {
  return InvoiceModel.findOne({
    stripeSubscriptionId,
    billingCycleNumber
  });
};

/**
 * Find transactions (invoices where payment was attempted) by tab
 * Used for transaction history endpoint
 */
exports.findTransactionsByTab = async (tabId, options = {}) => {
  const { status, limit, skip } = options;

  const query = {
    tabId,
    attempted: true // Only invoices where customer attempted payment
  };

  if (status) {
    query.status = status;
  }

  let queryBuilder = InvoiceModel.find(query)
    .populate("createdBy", "name completeName image")
    .sort({ createdAt: -1 });

  if (limit) queryBuilder = queryBuilder.limit(limit);
  if (skip) queryBuilder = queryBuilder.skip(skip);

  return queryBuilder.exec();
};

/**
 * Count invoices by tab (for pagination)
 */
exports.countInvoicesByTab = async (tabId, status = null) => {
  const query = { tabId };
  if (status) {
    query.status = status;
  }
  return InvoiceModel.countDocuments(query);
};

/**
 * Get invoice summary stats for dashboard cards
 * Returns: outstanding, overdue, totalBilled, totalReceived
 */
exports.getInvoiceSummaryStats = async (tabId, days = 60) => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const tabObjectId = new Types.ObjectId(tabId);

  // Run all aggregations in parallel
  const [outstanding, overdue, totalBilled, totalReceived] = await Promise.all([
    // Outstanding: open invoices (no date filter)
    InvoiceModel.aggregate([
      { $match: { tabId: tabObjectId, status: 'open' } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amountDue' } } }
    ]),

    // Overdue: open invoices with dueDate < now
    InvoiceModel.aggregate([
      { $match: {
        tabId: tabObjectId,
        status: 'open',
        dueDate: { $lt: now }
      }},
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amountDue' } } }
    ]),

    // Total billed in past X days (all non-draft invoices created)
    InvoiceModel.aggregate([
      { $match: {
        tabId: tabObjectId,
        createdAt: { $gte: pastDate },
        status: { $ne: 'draft' }
      }},
      { $group: { _id: null, amount: { $sum: '$amountDue' } } }
    ]),

    // Total received in past X days (paid invoices)
    InvoiceModel.aggregate([
      { $match: {
        tabId: tabObjectId,
        status: 'paid',
        paidAt: { $gte: pastDate }
      }},
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amountPaid' } } }
    ])
  ]);

  return {
    outstanding: { count: outstanding[0]?.count || 0, amount: outstanding[0]?.amount || 0 },
    overdue: { count: overdue[0]?.count || 0, amount: overdue[0]?.amount || 0 },
    totalBilled: { amount: totalBilled[0]?.amount || 0, days },
    totalReceived: { count: totalReceived[0]?.count || 0, amount: totalReceived[0]?.amount || 0, days }
  };
};

/**
 * Find invoices by company (for company-wide invoices list)
 */
exports.findInvoicesByCompany = async (companyId, options = {}) => {
  const { status, limit = 10, skip = 0 } = options;

  const query = { companyId: new Types.ObjectId(companyId) };

  if (status) {
    query.status = status;
  }

  return InvoiceModel.find(query)
    .populate("tabId", "name")
    .populate("clientId", "businessName")
    .populate("createdBy", "name completeName image")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .exec();
};

/**
 * Count invoices by company (for pagination)
 */
exports.countInvoicesByCompany = async (companyId, status = null) => {
  const query = { companyId: new Types.ObjectId(companyId) };
  if (status) {
    query.status = status;
  }
  return InvoiceModel.countDocuments(query);
};

/**
 * Get invoice summary stats by company (for dashboard cards)
 */
exports.getInvoiceSummaryStatsByCompany = async (companyId, days = 60) => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const companyObjectId = new Types.ObjectId(companyId);

  const [outstanding, overdue, totalBilled, totalReceived] = await Promise.all([
    // Outstanding: open invoices
    InvoiceModel.aggregate([
      { $match: { companyId: companyObjectId, status: 'open' } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amountDue' } } }
    ]),

    // Overdue: open invoices with dueDate < now
    InvoiceModel.aggregate([
      { $match: {
        companyId: companyObjectId,
        status: 'open',
        dueDate: { $lt: now }
      }},
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amountDue' } } }
    ]),

    // Total billed in past X days
    InvoiceModel.aggregate([
      { $match: {
        companyId: companyObjectId,
        createdAt: { $gte: pastDate },
        status: { $ne: 'draft' }
      }},
      { $group: { _id: null, amount: { $sum: '$amountDue' } } }
    ]),

    // Total received in past X days
    InvoiceModel.aggregate([
      { $match: {
        companyId: companyObjectId,
        status: 'paid',
        paidAt: { $gte: pastDate }
      }},
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amountPaid' } } }
    ])
  ]);

  return {
    outstanding: { count: outstanding[0]?.count || 0, amount: outstanding[0]?.amount || 0 },
    overdue: { count: overdue[0]?.count || 0, amount: overdue[0]?.amount || 0 },
    totalBilled: { amount: totalBilled[0]?.amount || 0, days },
    totalReceived: { count: totalReceived[0]?.count || 0, amount: totalReceived[0]?.amount || 0, days }
  };
};

/**
 * Count transactions (attempted invoices) by tab
 */
exports.countTransactionsByTab = async (tabId, status = null) => {
  const query = {
    tabId,
    attempted: true
  };

  if (status) {
    query.status = status;
  }

  return InvoiceModel.countDocuments(query);
};

/**
 * Find transactions (attempted invoices) by company - for company-wide dashboard
 */
exports.findTransactionsByCompany = async (companyId, options = {}) => {
  const { status, limit = 100, skip = 0, startDate, endDate, search } = options;

  const query = {
    companyId,
    attempted: true
  };

  if (status && status !== "all") {
    query.status = status;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Search across text fields and amount
  if (search) {
    const searchRegex = { $regex: search, $options: "i" };
    const searchConditions = [
      { invoiceNumber: searchRegex },
      { "billTo.name": searchRegex },
      { "billTo.email": searchRegex },
      { labels: searchRegex }
    ];
    // If numeric, also match amount (convert to cents)
    const numericValue = parseFloat(search);
    if (!isNaN(numericValue)) {
      const amountInCents = Math.round(numericValue * 100);
      searchConditions.push({ amountPaid: amountInCents });
    }
    query.$or = searchConditions;
  }

  return InvoiceModel.find(query)
    .populate("tabId", "name")
    .populate("clientId", "businessName")
    .populate("createdBy", "name completeName image")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .exec();
};

/**
 * Count transactions (attempted invoices) by company
 */
exports.countTransactionsByCompany = async (companyId, options = {}) => {
  const { status, startDate, endDate, search } = options;

  const query = {
    companyId,
    attempted: true
  };

  if (status && status !== "all") {
    query.status = status;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Search across text fields and amount
  if (search) {
    const searchRegex = { $regex: search, $options: "i" };
    const searchConditions = [
      { invoiceNumber: searchRegex },
      { "billTo.name": searchRegex },
      { "billTo.email": searchRegex },
      { labels: searchRegex }
    ];
    const numericValue = parseFloat(search);
    if (!isNaN(numericValue)) {
      const amountInCents = Math.round(numericValue * 100);
      searchConditions.push({ amountPaid: amountInCents });
    }
    query.$or = searchConditions;
  }

  return InvoiceModel.countDocuments(query);
};

/**
 * Update invoice labels
 */
exports.updateInvoiceLabels = async (invoiceId, labels) => {
  return InvoiceModel.findByIdAndUpdate(
    invoiceId,
    { $set: { labels } },
    { new: true }
  );
};

/**
 * Get revenue stats by tab for a specific year
 * Returns monthly totals and largest payment per month
 */
exports.getRevenueStatsByTab = async (tabId, year) => {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
  const tabObjectId = new Types.ObjectId(tabId);

  const result = await InvoiceModel.aggregate([
    {
      $match: {
        tabId: tabObjectId,
        status: "paid",
        paidAt: { $gte: startOfYear, $lte: endOfYear }
      }
    },
    {
      $group: {
        _id: { $month: "$paidAt" },
        totalAmount: { $sum: "$amountPaid" },
        largestPayment: { $max: "$amountPaid" }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  return result;
};

/**
 * Get all-time total revenue for a tab
 */
exports.getTotalRevenueByTab = async (tabId) => {
  const tabObjectId = new Types.ObjectId(tabId);

  const result = await InvoiceModel.aggregate([
    {
      $match: {
        tabId: tabObjectId,
        status: "paid"
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amountPaid" }
      }
    }
  ]);

  return result.length > 0 ? result[0].total : 0;
};

/**
 * Get monthly revenue stats for a client (company-scoped, no tabId)
 */
exports.getRevenueStatsByClient = async (clientId, year) => {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
  const clientObjectId = new Types.ObjectId(clientId);

  return InvoiceModel.aggregate([
    {
      $match: {
        clientId: clientObjectId,
        status: "paid",
        paidAt: { $gte: startOfYear, $lte: endOfYear },
      },
    },
    {
      $group: {
        _id: { $month: "$paidAt" },
        totalAmount: { $sum: "$amountPaid" },
        largestPayment: { $max: "$amountPaid" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

/**
 * Get all-time total revenue for a client (company-scoped, no tabId)
 */
exports.getTotalRevenueByClient = async (clientId) => {
  const clientObjectId = new Types.ObjectId(clientId);

  const result = await InvoiceModel.aggregate([
    { $match: { clientId: clientObjectId, status: "paid" } },
    { $group: { _id: null, total: { $sum: "$amountPaid" } } },
  ]);

  return result.length > 0 ? result[0].total : 0;
};

/**
 * Get monthly revenue stats for a company (for graph display)
 * Returns monthly totals and largest payments for the specified year
 */
exports.getRevenueStatsByCompany = async (companyId, year) => {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
  const companyObjectId = new Types.ObjectId(companyId);

  const result = await InvoiceModel.aggregate([
    {
      $match: {
        companyId: companyObjectId,
        status: "paid",
        paidAt: { $gte: startOfYear, $lte: endOfYear }
      }
    },
    {
      $group: {
        _id: { $month: "$paidAt" },
        totalAmount: { $sum: "$amountPaid" },
        largestPayment: { $max: "$amountPaid" }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  return result;
};

/**
 * Get all-time total revenue for a company
 */
exports.getTotalRevenueByCompany = async (companyId) => {
  const companyObjectId = new Types.ObjectId(companyId);

  const result = await InvoiceModel.aggregate([
    {
      $match: {
        companyId: companyObjectId,
        status: "paid"
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amountPaid" }
      }
    }
  ]);

  return result.length > 0 ? result[0].total : 0;
};

// Export the model
exports.InvoiceModel = InvoiceModel;
