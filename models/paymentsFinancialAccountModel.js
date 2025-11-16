"use strict";

const { Schema, model } = require("mongoose");

/**
 * Financial Account Schema
 * Represents a Stripe Treasury Financial Account for a company
 * Used for Issuing balance and full BaaS features
 */
const financialAccountSchema = new Schema(
  {
    // ==================== Company Reference ====================

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
      unique: true // One Financial Account per company
    },

    // ==================== Stripe References ====================

    stripeAccountId: {
      type: String,
      required: true,
      index: true
    },

    stripeFinancialAccountId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // ==================== Account Details ====================

    supportedCurrencies: {
      type: [String],
      default: ["usd"]
    },

    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      required: true
    },

    // ==================== Features ====================

    features: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {}
    },

    // ==================== Balance ====================

    balance: {
      cash: {
        type: Map,
        of: Number,
        default: {}
      },
      inbound_pending: {
        type: Map,
        of: Number,
        default: {}
      },
      outbound_pending: {
        type: Map,
        of: Number,
        default: {}
      }
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// ==================== Indexes ====================

financialAccountSchema.index({ companyId: 1, stripeAccountId: 1 });
financialAccountSchema.index({ stripeFinancialAccountId: 1 }, { unique: true });

// ==================== Model ====================

const FinancialAccountModel = model("PaymentsFinancialAccount", financialAccountSchema);

// ==================== Query Methods ====================

/**
 * Find Financial Account by company ID
 */
exports.findFinancialAccountByCompany = async (companyId) => {
  return FinancialAccountModel.findOne({ companyId });
};

/**
 * Find Financial Account by Stripe ID
 */
exports.findFinancialAccountByStripeId = async (stripeFinancialAccountId) => {
  return FinancialAccountModel.findOne({ stripeFinancialAccountId });
};

/**
 * Create new Financial Account
 */
exports.createFinancialAccount = async (accountData) => {
  return FinancialAccountModel.create(accountData);
};

/**
 * Update Financial Account status
 */
exports.updateFinancialAccountStatus = async (filter, status, additionalData = {}) => {
  const updateData = { status, ...additionalData };
  return FinancialAccountModel.findOneAndUpdate(
    filter,
    { $set: updateData },
    { new: true }
  );
};

/**
 * Update Financial Account
 */
exports.updateFinancialAccount = async (filter, updateData) => {
  return FinancialAccountModel.findOneAndUpdate(
    filter,
    { $set: updateData },
    { new: true }
  );
};

// Export model for direct use if needed
exports.FinancialAccountModel = FinancialAccountModel;
