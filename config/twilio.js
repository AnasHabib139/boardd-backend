"use strict";

/**
 * Twilio Master Account Configuration
 *
 * This master account is used ONLY for provisioning subaccounts for companies.
 * Never use for sending messages - always use company-specific subaccounts.
 *
 * Security: Master credentials must NEVER be exposed to API responses
 */

const twilio = require("twilio");

// Initialize master account client
let masterClient = null;

if (process.env.TWILIO_MASTER_ACCOUNT_SID && process.env.TWILIO_MASTER_AUTH_TOKEN) {
  masterClient = twilio(
    process.env.TWILIO_MASTER_ACCOUNT_SID,
    process.env.TWILIO_MASTER_AUTH_TOKEN
  );
  console.log("✓ Twilio master account client initialized");
} else {
  console.warn("⚠ WARNING: Twilio master account not configured - provisioning will be disabled");
  console.warn("  Set TWILIO_MASTER_ACCOUNT_SID and TWILIO_MASTER_AUTH_TOKEN to enable provisioning");
}

/**
 * Get Twilio master account client
 * Used for creating subaccounts, purchasing numbers, etc.
 * @returns {Object} Twilio client for master account
 * @throws {Error} If master account not configured
 */
function getMasterClient() {
  if (!masterClient) {
    throw new Error("Twilio master account not configured. Cannot provision resources.");
  }
  return masterClient;
}

/**
 * Check if provisioning is enabled
 * @returns {Boolean} True if master account configured
 */
function isProvisioningEnabled() {
  return !!masterClient;
}

module.exports = {
  getMasterClient,
  isProvisioningEnabled
};
