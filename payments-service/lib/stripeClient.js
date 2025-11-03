"use strict";

const Stripe = require("stripe");
const config = require("../config");

/**
 * Initialize and export Stripe client
 * Note: apiVersion is omitted - Stripe SDK will use its built-in version
 */
const stripe = Stripe(config.stripe.secretKey, {
  maxNetworkRetries: 2,
  timeout: 80000,
  telemetry: true,
  appInfo: {
    name: "Boardd Payments Service",
    version: "1.0.0",
    url: "https://boardd.com",
  },
});

/**
 * Get Stripe client instance
 * For platform-level operations
 */
function getPlatformStripeClient() {
  return stripe;
}

/**
 * Create Stripe client for connected account operations
 * @param {string} stripeAccountId - Connected account ID
 * @returns {object} Request options with stripeAccount header
 */
function getConnectedAccountOptions(stripeAccountId) {
  return {
    stripeAccount: stripeAccountId,
  };
}

module.exports = {
  stripe,
  getPlatformStripeClient,
  getConnectedAccountOptions,
};
