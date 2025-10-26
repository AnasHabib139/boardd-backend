"use strict";

/**
 * WhatsApp Template Model
 *
 * Stores WhatsApp message templates for companies
 * Templates are submitted to Meta for approval via Twilio Content API
 * Once approved, can be used for messages outside 24-hour customer care window
 */

const { Schema, model, Types } = require("mongoose");

const whatsappTemplateSchema = new Schema(
  {
    // Company this template belongs to
    companyId: {
      type: Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Template name (lowercase, underscores only, e.g., "order_confirmation")
    name: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    // Language code (e.g., "en", "es", "fr")
    language: {
      type: String,
      required: true,
      default: "en",
      lowercase: true,
    },

    // Approval status from Meta
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    // Template category (determines approval requirements)
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      required: true,
    },

    // Twilio Content SID (returned from Content API)
    twilioContentSid: {
      type: String,
      index: true,
    },

    // Template components (HEADER, BODY, FOOTER, BUTTONS)
    components: [
      {
        // Component type
        type: {
          type: String,
          enum: ["HEADER", "BODY", "FOOTER", "BUTTONS"],
          required: true,
        },

        // Component text (with placeholders like {{1}}, {{2}})
        text: {
          type: String,
        },

        // Parameter names (for documentation)
        parameters: [String],

        // Button definitions (for interactive templates)
        buttons: [
          {
            type: {
              type: String,
              enum: ["quick_reply", "url", "phone_number"],
            },
            text: String,
            url: String,
            phoneNumber: String,
          },
        ],
      },
    ],

    // Usage tracking
    usageCount: {
      type: Number,
      default: 0,
    },

    lastUsedAt: {
      type: Date,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound index: company + name + language must be unique
whatsappTemplateSchema.index(
  { companyId: 1, name: 1, language: 1 },
  { unique: true }
);

// Index for finding pending templates (for approval polling)
whatsappTemplateSchema.index({ status: 1, updatedAt: 1 });

// Helper method: Increment usage count
whatsappTemplateSchema.methods.incrementUsage = async function () {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  await this.save();
};

// Static method: Find approved templates for company
whatsappTemplateSchema.statics.findApproved = function (companyId) {
  return this.find({
    companyId,
    status: "approved",
  }).sort({ name: 1 });
};

// Static method: Find pending templates needing approval check
whatsappTemplateSchema.statics.findPending = function () {
  return this.find({
    status: "pending",
  }).sort({ createdAt: 1 });
};

const WhatsAppTemplate = model("WhatsAppTemplate", whatsappTemplateSchema);

module.exports = WhatsAppTemplate;
