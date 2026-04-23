"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

// Account statuses
const ACCOUNT_STATUSES = {
  PENDING: "pending",
  ACTIVE: "active",
  RESTRICTED: "restricted",
  DISABLED: "disabled",
};

// Capability statuses
const CAPABILITY_STATUSES = {
  PENDING: "pending",
  ACTIVE: "active",
  INACTIVE: "inactive",
};

// Business types
const BUSINESS_TYPES = {
  COMPANY: "company",
  INDIVIDUAL: "individual",
};

const paymentsStripeAccountSchema = new Schema(
  {
    // Company reference (from main backend)
    companyId: {
      type: Types.ObjectId,
      ref: "Company",
      required: true,
    },

    // Stripe Account Details
    stripeAccountId: {
      type: String,
      required: true,
    },

    country: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
    },

    accountType: {
      type: String,
      required: true,
      default: "custom",
    },

    accountStatus: {
      type: String,
      enum: Object.values(ACCOUNT_STATUSES),
      default: ACCOUNT_STATUSES.PENDING,
    },

    businessType: {
      type: String,
      enum: Object.values(BUSINESS_TYPES),
      required: true,
    },

    email: {
      type: String,
      required: true,
    },

    // Capabilities
    capabilities: {
      cardPayments: {
        type: String,
        enum: Object.values(CAPABILITY_STATUSES),
        default: CAPABILITY_STATUSES.INACTIVE,
      },
      transfers: {
        type: String,
        enum: Object.values(CAPABILITY_STATUSES),
        default: CAPABILITY_STATUSES.INACTIVE,
      },
      issuing: {
        type: String,
        enum: Object.values(CAPABILITY_STATUSES),
        default: CAPABILITY_STATUSES.INACTIVE,
      },
      treasury: {
        type: String,
        enum: Object.values(CAPABILITY_STATUSES),
        default: CAPABILITY_STATUSES.INACTIVE,
      },
    },

    // Account Status Flags
    chargesEnabled: {
      type: Boolean,
      default: false,
    },

    payoutsEnabled: {
      type: Boolean,
      default: false,
    },

    onboardingComplete: {
      type: Boolean,
      default: false,
    },

    detailsSubmitted: {
      type: Boolean,
      default: false,
    },

    // Encrypted Secrets (select: false for security)
    secretKey: {
      type: String,
      select: false,
    },

    publishableKey: {
      type: String,
    },

    webhookSecret: {
      type: String,
      select: false,
    },

    // Business Information
    businessInfo: {
      legalName: String,
      dba: String,
      industry: String,
      taxId: String, // Will be encrypted
      description: String,
      url: String,
      phone: String,
      timezone: String,
      mcc: String, // Merchant Category Code
      address: {
        line1: String,
        line2: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
      },
    },

    // Public-facing Support Details
    publicDetails: {
      supportEmail: String,
      supportPhone: String,
      supportUrl: String,
      supportAddress: {
        line1: String,
        line2: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
      },
      descriptor: String, // Statement descriptor
    },

    // Account Management
    accountRepresentative: {
      type: Types.ObjectId,
      ref: "User",
    },

    ownership: String,

    // Persons (Representatives/Owners)
    persons: [
      {
        personId: String, // Stripe person ID
        relationship: {
          representative: Boolean,
          owner: Boolean,
          title: String,
          percentOwnership: Number,
        },
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        dateOfBirth: {
          day: Number,
          month: Number,
          year: Number,
        },
        address: {
          line1: String,
          line2: String,
          city: String,
          state: String,
          postalCode: String,
          country: String,
        },
        verification: {
          status: String,
          document: {
            front: String,
            back: String,
          },
        },
        createdAt: Date,
      },
    ],

    // External Bank Accounts
    externalAccounts: [
      {
        bankAccountId: String, // Stripe bank account ID
        accountHolderName: String,
        accountHolderType: String,
        bankName: String,
        country: String,
        currency: String,
        last4: String,
        routingNumber: String,
        isDefault: Boolean,
        createdAt: Date,
      },
    ],

    // Requirements Tracking
    requirements: {
      currentlyDue: [String],
      eventuallyDue: [String],
      pastDue: [String],
      disabledReason: String,
      currentDeadline: Date,
    },

    // TOS Acceptance
    tosAcceptance: {
      date: Number, // Unix timestamp
      ip: String,
      userAgent: String,
    },

    // Metadata
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
paymentsStripeAccountSchema.index({ companyId: 1, stripeAccountId: 1 });
paymentsStripeAccountSchema.index({ stripeAccountId: 1 }, { unique: true });
paymentsStripeAccountSchema.index({ companyId: 1, onboardingComplete: 1 });

// Pagination plugin
paymentsStripeAccountSchema.plugin(mongoosePaginate);

// Pre-save hook for encryption
paymentsStripeAccountSchema.pre("save", function (next) {
  try {
    const { encrypt } = require("../../utils/encryption");

    // Encrypt secret key
    if (this.isModified("secretKey") && this.secretKey && !this.secretKey.includes("encrypted:")) {
      this.secretKey = `encrypted:${encrypt(this.secretKey)}`;
    }

    // Encrypt webhook secret
    if (this.isModified("webhookSecret") && this.webhookSecret && !this.webhookSecret.includes("encrypted:")) {
      this.webhookSecret = `encrypted:${encrypt(this.webhookSecret)}`;
    }

    // Encrypt tax ID
    if (this.isModified("businessInfo.taxId") && this.businessInfo?.taxId && !this.businessInfo.taxId.includes("encrypted:")) {
      this.businessInfo.taxId = `encrypted:${encrypt(this.businessInfo.taxId)}`;
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Instance method to decrypt secret key
paymentsStripeAccountSchema.methods.getDecryptedSecretKey = function () {
  if (!this.secretKey) return null;
  const { decrypt } = require("../../utils/encryption");
  const encryptedToken = this.secretKey.replace("encrypted:", "");
  return decrypt(encryptedToken);
};

// Instance method to decrypt webhook secret
paymentsStripeAccountSchema.methods.getDecryptedWebhookSecret = function () {
  if (!this.webhookSecret) return null;
  const { decrypt } = require("../../utils/encryption");
  const encryptedToken = this.webhookSecret.replace("encrypted:", "");
  return decrypt(encryptedToken);
};

// Instance method to decrypt tax ID
paymentsStripeAccountSchema.methods.getDecryptedTaxId = function () {
  if (!this.businessInfo?.taxId) return null;
  const { decrypt } = require("../../utils/encryption");
  const encryptedToken = this.businessInfo.taxId.replace("encrypted:", "");
  return decrypt(encryptedToken);
};

// Instance method to check if onboarding is complete
paymentsStripeAccountSchema.methods.checkOnboardingComplete = function () {
  return (
    this.chargesEnabled &&
    this.payoutsEnabled &&
    this.detailsSubmitted &&
    this.requirements.currentlyDue.length === 0 &&
    this.requirements.pastDue.length === 0
  );
};

const PaymentsStripeAccount = model("PaymentsStripeAccount", paymentsStripeAccountSchema);

// Helper functions for CRUD operations
exports.createAccount = (data) => PaymentsStripeAccount.create(data);

exports.findAccount = (query) => PaymentsStripeAccount.findOne(query);

exports.findAccountWithSecrets = (query) =>
  PaymentsStripeAccount.findOne(query).select("+secretKey +webhookSecret");

exports.findAccountByCompany = (companyId) =>
  PaymentsStripeAccount.findOne({ companyId });

exports.findAccountByStripeId = (stripeAccountId) =>
  PaymentsStripeAccount.findOne({ stripeAccountId });

exports.updateAccount = (query, updateData) =>
  PaymentsStripeAccount.findOneAndUpdate(query, updateData, { new: true });

exports.deleteAccount = (accountId) =>
  PaymentsStripeAccount.findByIdAndDelete(accountId);

// Export constants
exports.ACCOUNT_STATUSES = ACCOUNT_STATUSES;
exports.CAPABILITY_STATUSES = CAPABILITY_STATUSES;
exports.BUSINESS_TYPES = BUSINESS_TYPES;
exports.PaymentsStripeAccount = PaymentsStripeAccount;
