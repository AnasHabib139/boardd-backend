"use strict";

/**
 * SendGrid Master Account Configuration
 *
 * This master account is used for:
 * 1. Adding verified senders for company email addresses
 * 2. Sending emails on behalf of companies
 * 3. Configuring inbound parse webhooks
 *
 * Companies never see "SendGrid" - they only see "Email Configuration"
 * All emails sent via OUR SendGrid account, from THEIR verified addresses
 *
 * Security: Master API key must NEVER be exposed to API responses
 */

const sgMail = require("@sendgrid/mail");
const sgClient = require("@sendgrid/client");

// Initialize master SendGrid client
let masterApiKey = null;
let isInitialized = false;

if (process.env.SENDGRID_MASTER_API_KEY) {
  masterApiKey = process.env.SENDGRID_MASTER_API_KEY;

  // Initialize both mail and client SDKs
  sgMail.setApiKey(masterApiKey);
  sgClient.setApiKey(masterApiKey);

  isInitialized = true;
  console.log("✓ SendGrid master account client initialized");
} else {
  console.warn("⚠ WARNING: SendGrid master account not configured - email provisioning will be disabled");
  console.warn("  Set SENDGRID_MASTER_API_KEY to enable email provisioning");
}

/**
 * Get SendGrid mail client (for sending emails)
 * @returns {Object} SendGrid mail client
 * @throws {Error} If master account not configured
 */
function getMailClient() {
  if (!isInitialized) {
    throw new Error("SendGrid master account not configured. Cannot send emails.");
  }
  return sgMail;
}

/**
 * Get SendGrid API client (for management operations)
 * Used for adding verified senders, configuring inbound parse, etc.
 * @returns {Object} SendGrid client API
 * @throws {Error} If master account not configured
 */
function getApiClient() {
  if (!isInitialized) {
    throw new Error("SendGrid master account not configured. Cannot manage senders.");
  }
  return sgClient;
}

/**
 * Check if email provisioning is enabled
 * @returns {Boolean} True if master account configured
 */
function isEmailProvisioningEnabled() {
  return isInitialized;
}

/**
 * Get master API key (use sparingly, only for direct API calls)
 * @returns {String} SendGrid master API key
 * @throws {Error} If master account not configured
 */
function getMasterApiKey() {
  if (!isInitialized) {
    throw new Error("SendGrid master account not configured.");
  }
  return masterApiKey;
}

module.exports = {
  getMailClient,
  getApiClient,
  getMasterApiKey,
  isEmailProvisioningEnabled
};
