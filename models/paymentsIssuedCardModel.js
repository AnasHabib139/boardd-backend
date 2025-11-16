"use strict";

const { Schema, model } = require("mongoose");

/**
 * Issued Card Schema
 * Represents a Stripe Issuing Card (virtual or physical card)
 * Currently focusing on virtual cards only
 */
const issuedCardSchema = new Schema(
  {
    // ==================== References ====================

    cardholderId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentsCardholder",
      required: true,
      index: true
    },

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    stripeAccountId: {
      type: String,
      required: true,
      index: true
    },

    stripeCardId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // ==================== Card Details ====================

    // Last 4 digits of card number
    last4: {
      type: String,
      required: true
    },

    // Card brand (Visa, Mastercard, etc.)
    brand: {
      type: String,
      required: true
    },

    // Expiration month (1-12)
    expMonth: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },

    // Expiration year (4-digit)
    expYear: {
      type: Number,
      required: true
    },

    // Card type (virtual or physical)
    type: {
      type: String,
      enum: ["virtual", "physical"],
      default: "virtual",
      required: true
    },

    // ==================== Status ====================

    // Card status from Stripe
    status: {
      type: String,
      enum: ["active", "inactive", "canceled"],
      default: "active",
      required: true,
      index: true
    },

    // Cancellation reason (if card was canceled)
    cancellationReason: {
      type: String,
      enum: ["lost", "stolen", "design_rejected", null],
      default: null
    },

    // ==================== Spending Controls ====================

    // Spending limits and controls
    spendingControls: {
      // Spending limit per interval
      spendingLimits: [
        {
          amount: Number,
          interval: {
            type: String,
            enum: ["per_authorization", "daily", "weekly", "monthly", "yearly", "all_time"]
          },
          categories: [String] // Merchant category codes
        }
      ],

      // Allowed merchant categories
      allowedCategories: [String],

      // Blocked merchant categories
      blockedCategories: [String],

      // Spending limit currency
      spendingLimitsCurrency: {
        type: String,
        default: "usd"
      }
    },

    // ==================== Metadata ====================

    // Additional metadata from Stripe
    metadata: {
      type: Map,
      of: String
    },

    // ==================== Freeze Status ====================

    // Whether card is frozen (user action, not Stripe status)
    isFrozen: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// ==================== Indexes ====================

issuedCardSchema.index({ companyId: 1, status: 1 });
issuedCardSchema.index({ cardholderId: 1 });
issuedCardSchema.index({ stripeCardId: 1 }, { unique: true });

// ==================== Model ====================

const IssuedCardModel = model("PaymentsIssuedCard", issuedCardSchema);

// ==================== Query Methods ====================

/**
 * Find card by company ID
 */
exports.findCardByCompany = async (companyId) => {
  return IssuedCardModel.findOne({ companyId });
};

/**
 * Find all cards by company ID
 */
exports.findCardsByCompany = async (companyId, status = null) => {
  const query = { companyId };
  if (status) {
    query.status = status;
  }
  return IssuedCardModel.find(query).sort({ createdAt: -1 });
};

/**
 * Find card by cardholder ID
 */
exports.findCardByCardholder = async (cardholderId) => {
  return IssuedCardModel.findOne({ cardholderId });
};

/**
 * Find card by Stripe card ID
 */
exports.findCardByStripeId = async (stripeCardId) => {
  return IssuedCardModel.findOne({ stripeCardId });
};

/**
 * Create new card
 */
exports.createCard = async (cardData) => {
  return IssuedCardModel.create(cardData);
};

/**
 * Update card status
 */
exports.updateCardStatus = async (filter, status, additionalData = {}) => {
  const updateData = { status, ...additionalData };
  return IssuedCardModel.findOneAndUpdate(
    filter,
    { $set: updateData },
    { new: true }
  );
};

/**
 * Update card
 */
exports.updateCard = async (filter, updateData) => {
  return IssuedCardModel.findOneAndUpdate(
    filter,
    { $set: updateData },
    { new: true }
  );
};

/**
 * Delete card
 */
exports.deleteCard = async (filter) => {
  return IssuedCardModel.findOneAndDelete(filter);
};

/**
 * Delete multiple cards
 */
exports.deleteCards = async (filter) => {
  return IssuedCardModel.deleteMany(filter);
};

// Export model for direct use if needed
exports.IssuedCardModel = IssuedCardModel;
