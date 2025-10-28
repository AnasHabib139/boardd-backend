"use strict";

const { Schema, model, Types } = require("mongoose");
const { encrypt, decrypt } = require("../utils/encryption");

const CLOUD_PROVIDERS = {
  GOOGLE_DRIVE: "google_drive",
  DROPBOX: "dropbox",
  ONEDRIVE: "onedrive",
};

const cloudIntegrationSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: Object.values(CLOUD_PROVIDERS),
      index: true,
    },
    // Encrypted OAuth tokens
    accessToken: {
      type: String,
      required: true,
      select: false, // Don't return in queries by default
    },
    refreshToken: {
      type: String,
      select: false, // Don't return in queries by default
    },
    tokenExpiry: {
      type: Date,
      required: true,
    },
    // Account information
    accountEmail: {
      type: String,
      required: true,
    },
    accountName: {
      type: String,
    },
    accountId: {
      type: String, // Provider-specific account ID
    },
    // OAuth scopes granted
    scopes: {
      type: [String],
      default: [],
    },
    // Status
    isActive: {
      type: Boolean,
      default: true,
    },
    // Additional metadata (provider-specific)
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    // Last sync/usage timestamp
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure one integration per user per provider
cloudIntegrationSchema.index({ userId: 1, provider: 1 }, { unique: true });

// Index for finding active integrations
cloudIntegrationSchema.index({ userId: 1, isActive: 1 });

// Pre-save hook to encrypt tokens
cloudIntegrationSchema.pre("save", function (next) {
  if (this.isModified("accessToken") && this.accessToken && !this.accessToken.includes("encrypted:")) {
    try {
      this.accessToken = `encrypted:${encrypt(this.accessToken)}`;
    } catch (error) {
      return next(error);
    }
  }

  if (this.isModified("refreshToken") && this.refreshToken && !this.refreshToken.includes("encrypted:")) {
    try {
      this.refreshToken = `encrypted:${encrypt(this.refreshToken)}`;
    } catch (error) {
      return next(error);
    }
  }

  next();
});

// Method to get decrypted access token
cloudIntegrationSchema.methods.getDecryptedAccessToken = function () {
  if (!this.accessToken) return null;

  try {
    const encryptedToken = this.accessToken.replace("encrypted:", "");
    return decrypt(encryptedToken);
  } catch (error) {
    console.error("Error decrypting access token:", error);
    return null;
  }
};

// Method to get decrypted refresh token
cloudIntegrationSchema.methods.getDecryptedRefreshToken = function () {
  if (!this.refreshToken) return null;

  try {
    const encryptedToken = this.refreshToken.replace("encrypted:", "");
    return decrypt(encryptedToken);
  } catch (error) {
    console.error("Error decrypting refresh token:", error);
    return null;
  }
};

// Method to check if token is expired
cloudIntegrationSchema.methods.isTokenExpired = function () {
  if (!this.tokenExpiry) return true;
  return new Date() >= this.tokenExpiry;
};

// Method to update last used timestamp
cloudIntegrationSchema.methods.updateLastUsed = function () {
  this.lastUsedAt = new Date();
  return this.save();
};

const CloudIntegrationModel = model("CloudIntegration", cloudIntegrationSchema);

// Helper methods

/**
 * Create a new cloud integration
 */
exports.createIntegration = (data) => CloudIntegrationModel.create(data);

/**
 * Find integration by user and provider
 */
exports.findIntegration = (query) => CloudIntegrationModel.findOne(query);

/**
 * Find integration with tokens (use select to include encrypted fields)
 */
exports.findIntegrationWithTokens = (query) =>
  CloudIntegrationModel.findOne(query).select("+accessToken +refreshToken");

/**
 * Find all integrations for a user
 */
exports.findUserIntegrations = (userId) =>
  CloudIntegrationModel.find({ userId, isActive: true });

/**
 * Update integration tokens
 */
exports.updateIntegrationTokens = async (integrationId, tokenData) => {
  const integration = await CloudIntegrationModel.findById(integrationId).select("+accessToken +refreshToken");

  if (!integration) {
    throw new Error("Integration not found");
  }

  if (tokenData.accessToken) {
    integration.accessToken = tokenData.accessToken;
  }

  if (tokenData.refreshToken) {
    integration.refreshToken = tokenData.refreshToken;
  }

  if (tokenData.tokenExpiry) {
    integration.tokenExpiry = tokenData.tokenExpiry;
  }

  // Reactivate the integration when updating tokens (for reconnection after disconnect)
  integration.isActive = true;
  integration.lastUsedAt = new Date();

  return await integration.save();
};

/**
 * Disconnect integration (soft delete)
 */
exports.disconnectIntegration = (integrationId) =>
  CloudIntegrationModel.findByIdAndUpdate(
    integrationId,
    { isActive: false },
    { new: true }
  );

/**
 * Delete integration (hard delete)
 */
exports.deleteIntegration = (integrationId) =>
  CloudIntegrationModel.findByIdAndDelete(integrationId);

/**
 * Update integration metadata
 */
exports.updateIntegration = (query, updateData) =>
  CloudIntegrationModel.findOneAndUpdate(query, updateData, { new: true });

// Export constants
exports.CLOUD_PROVIDERS = CLOUD_PROVIDERS;
exports.CloudIntegrationModel = CloudIntegrationModel;
