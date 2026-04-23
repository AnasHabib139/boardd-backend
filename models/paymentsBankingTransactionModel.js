"use strict";

const { Schema, model } = require("mongoose");

/**
 * Banking Transaction Schema
 * Stores payout and fund-card transfer records for company dashboard
 */
const bankingTransactionSchema = new Schema(
  {
    // ==================== Company Reference ====================

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    // ==================== Stripe References ====================

    stripeTransactionId: {
      type: String,
      required: true,
    },

    stripeAccountId: {
      type: String,
      required: true,
    },

    // ==================== Transaction Details ====================

    type: {
      type: String,
      enum: ["payout", "fund_card"],
      required: true,
      index: true
    },

    amount: {
      type: Number,
      required: true
    },

    currency: {
      type: String,
      default: "usd",
      lowercase: true
    },

    status: {
      type: String,
      enum: ["pending", "in_transit", "paid", "failed", "canceled", "succeeded"],
      required: true,
      index: true
    },

    description: {
      type: String,
      default: ""
    },

    // ==================== Payout-specific Fields ====================

    method: {
      type: String,
      enum: ["standard", "instant"],
      default: "standard"
    },

    destination: {
      last4: String,
      bankName: String,
      routingNumber: String
    },

    arrivalDate: {
      type: Date
    },

    // ==================== Failure Details (for payouts) ====================

    failureCode: {
      type: String
    },

    failureMessage: {
      type: String
    },

    // ==================== Custom Labels ====================

    labels: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// ==================== Indexes ====================

bankingTransactionSchema.index({ companyId: 1, createdAt: -1 });
bankingTransactionSchema.index({ companyId: 1, type: 1 });
bankingTransactionSchema.index({ companyId: 1, status: 1 });
bankingTransactionSchema.index({ stripeTransactionId: 1 }, { unique: true });

// ==================== Model ====================

const BankingTransactionModel = model("PaymentsBankingTransaction", bankingTransactionSchema);

// ==================== Query Methods ====================

/**
 * Create new Banking Transaction
 */
exports.createBankingTransaction = async (transactionData) => {
  return BankingTransactionModel.create(transactionData);
};

/**
 * Find Banking Transactions by company
 */
exports.findBankingTransactionsByCompany = async (companyId, options = {}) => {
  const { type, status, limit = 100, skip = 0, startDate, endDate, search } = options;

  const query = { companyId };

  if (type && type !== "all") {
    query.type = type;
  }

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
      { description: searchRegex },
      { "destination.bankName": searchRegex },
      { labels: searchRegex }
    ];
    // If numeric, also match amount (convert to cents)
    const numericValue = parseFloat(search);
    if (!isNaN(numericValue)) {
      const amountInCents = Math.round(numericValue * 100);
      searchConditions.push({ amount: amountInCents });
    }
    query.$or = searchConditions;
  }

  return BankingTransactionModel.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

/**
 * Count Banking Transactions by company
 */
exports.countBankingTransactionsByCompany = async (companyId, options = {}) => {
  const { type, status, startDate, endDate, search } = options;

  const query = { companyId };

  if (type && type !== "all") {
    query.type = type;
  }

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
      { description: searchRegex },
      { "destination.bankName": searchRegex },
      { labels: searchRegex }
    ];
    const numericValue = parseFloat(search);
    if (!isNaN(numericValue)) {
      const amountInCents = Math.round(numericValue * 100);
      searchConditions.push({ amount: amountInCents });
    }
    query.$or = searchConditions;
  }

  return BankingTransactionModel.countDocuments(query);
};

/**
 * Find Banking Transaction by Stripe ID
 */
exports.findBankingTransactionByStripeId = async (stripeTransactionId) => {
  return BankingTransactionModel.findOne({ stripeTransactionId });
};

/**
 * Find Banking Transaction by ID
 */
exports.findBankingTransactionById = async (id) => {
  return BankingTransactionModel.findById(id);
};

/**
 * Update Banking Transaction
 */
exports.updateBankingTransaction = async (filter, updateData) => {
  return BankingTransactionModel.findOneAndUpdate(
    filter,
    { $set: updateData },
    { new: true }
  );
};

/**
 * Update Banking Transaction labels
 */
exports.updateBankingTransactionLabels = async (id, labels) => {
  return BankingTransactionModel.findByIdAndUpdate(
    id,
    { $set: { labels } },
    { new: true }
  );
};

// Export model for direct use if needed
exports.BankingTransactionModel = BankingTransactionModel;
