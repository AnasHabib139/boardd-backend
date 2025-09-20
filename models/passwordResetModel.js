"use strict";

const mongoose = require("mongoose");
const mongooseAggregatePaginate = require("mongoose-aggregate-paginate-v2");

const passwordResetSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Reset code is required"],
      length: 6,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 15 * 60 * 1000), // 15 minutes from now
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    attempts: {
      type: Number,
      default: 0,
      max: 3,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
passwordResetSchema.index({ email: 1, createdAt: -1 });
passwordResetSchema.index({ expiresAt: 1 }); // For cleanup queries

// Plugin for pagination
passwordResetSchema.plugin(mongooseAggregatePaginate);

const PasswordReset = mongoose.model("PasswordReset", passwordResetSchema);

/**
 * Create a new password reset request
 * @param {Object} resetData - Reset request data
 * @returns {Promise<Object>} Created password reset document
 */
const createPasswordReset = async (resetData) => {
  const passwordReset = new PasswordReset(resetData);
  return await passwordReset.save();
};

/**
 * Find password reset by email and code
 * @param {string} email - User email
 * @param {string} code - Reset code
 * @returns {Promise<Object|null>} Password reset document or null
 */
const findPasswordReset = async (email, code) => {
  return await PasswordReset.findOne({
    email: email.toLowerCase(),
    code,
    isUsed: false,
  });
};

/**
 * Find the latest password reset request for an email
 * @param {string} email - User email
 * @returns {Promise<Object|null>} Latest password reset document or null
 */
const findLatestPasswordReset = async (email) => {
  return await PasswordReset.findOne({
    email: email.toLowerCase(),
  }).sort({ createdAt: -1 });
};

/**
 * Mark password reset as used
 * @param {string} resetId - Password reset document ID
 * @returns {Promise<Object>} Updated password reset document
 */
const markPasswordResetAsUsed = async (resetId) => {
  return await PasswordReset.findByIdAndUpdate(
    resetId,
    { isUsed: true },
    { new: true }
  );
};

/**
 * Increment attempt count for password reset
 * @param {string} resetId - Password reset document ID
 * @returns {Promise<Object>} Updated password reset document
 */
const incrementAttempts = async (resetId) => {
  return await PasswordReset.findByIdAndUpdate(
    resetId,
    { $inc: { attempts: 1 } },
    { new: true }
  );
};

/**
 * Delete expired password reset requests (for future cleanup)
 * @returns {Promise<Object>} Delete operation result
 */
const deleteExpiredResets = async () => {
  return await PasswordReset.deleteMany({
    expiresAt: { $lt: new Date() },
  });
};

/**
 * Check if a password reset request is expired
 * @param {Object} resetDoc - Password reset document
 * @returns {boolean} True if expired
 */
const isExpired = (resetDoc) => {
  return new Date() > resetDoc.expiresAt;
};

/**
 * Check if a password reset request has exceeded max attempts
 * @param {Object} resetDoc - Password reset document
 * @returns {boolean} True if max attempts exceeded
 */
const hasExceededAttempts = (resetDoc) => {
  return resetDoc.attempts >= 3;
};

module.exports = {
  PasswordReset,
  createPasswordReset,
  findPasswordReset,
  findLatestPasswordReset,
  markPasswordResetAsUsed,
  incrementAttempts,
  deleteExpiredResets,
  isExpired,
  hasExceededAttempts,
};