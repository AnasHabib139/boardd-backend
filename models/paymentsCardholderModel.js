"use strict";

const { Schema, model } = require("mongoose");

/**
 * Cardholder Schema
 * Represents a Stripe Issuing Cardholder (the entity that owns issued cards)
 * For company cardholders, this represents the business entity
 */
const cardholderSchema = new Schema(
  {
    // ==================== Company Reference ====================

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
      unique: true // One cardholder per company
    },

    // ==================== Stripe References ====================

    stripeAccountId: {
      type: String,
      required: true,
      index: true
    },

    stripeCardholderId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // ==================== Cardholder Details ====================

    // Type of cardholder (individual for Connected Account Issuing)
    type: {
      type: String,
      enum: ["company", "individual"],
      default: "individual",
      required: true
    },

    // Individual/Company name (full name)
    name: {
      type: String,
      required: true
    },

    // Individual first name
    firstName: {
      type: String
    },

    // Individual last name
    lastName: {
      type: String
    },

    // Contact email
    email: {
      type: String,
      required: true
    },

    // Contact phone number
    phoneNumber: {
      type: String
    },

    // ==================== Billing Address ====================

    billing: {
      address: {
        line1: String,
        line2: String,
        city: String,
        state: String,
        postal_code: String,
        country: String
      }
    },

    // ==================== Status ====================

    // Cardholder status from Stripe
    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active"
    },

    // ==================== Notification Preferences ====================

    // Notification settings for transaction alerts
    notificationPreferences: {
      email: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      },
      push: {
        type: Boolean,
        default: false  // For future mobile app integration
      }
    },

    // ==================== Metadata ====================

    // Additional metadata from Stripe
    metadata: {
      type: Map,
      of: String
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt
  }
);

// ==================== Indexes ====================

cardholderSchema.index({ companyId: 1, stripeAccountId: 1 });
cardholderSchema.index({ stripeCardholderId: 1 }, { unique: true });

// ==================== Model ====================

const CardholderModel = model("PaymentsCardholder", cardholderSchema);

// ==================== Query Methods ====================

/**
 * Find cardholder by company ID
 */
exports.findCardholderByCompany = async (companyId) => {
  return CardholderModel.findOne({ companyId });
};

/**
 * Find cardholder by Stripe cardholder ID
 */
exports.findCardholderByStripeId = async (stripeCardholderId) => {
  return CardholderModel.findOne({ stripeCardholderId });
};

/**
 * Create new cardholder
 */
exports.createCardholder = async (cardholderData) => {
  return CardholderModel.create(cardholderData);
};

/**
 * Update cardholder
 */
exports.updateCardholder = async (filter, updateData) => {
  return CardholderModel.findOneAndUpdate(
    filter,
    { $set: updateData },
    { new: true }
  );
};

/**
 * Delete cardholder
 */
exports.deleteCardholder = async (filter) => {
  return CardholderModel.findOneAndDelete(filter);
};

// Export model for direct use if needed
exports.CardholderModel = CardholderModel;
