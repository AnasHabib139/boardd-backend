"use strict";

/**
 * Payments Service Configuration
 * Centralized configuration for Stripe Connect and payment processing
 */

module.exports = {
  // Stripe Configuration
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    // Note: apiVersion is not specified - Stripe SDK uses its built-in version
  },

  // Service Configuration
  service: {
    port: process.env.PAYMENTS_PORT || 4000,
    mode: process.env.PAYMENTS_MODE || "embedded", // embedded | standalone
    internalServiceKey: process.env.INTERNAL_SERVICE_KEY || "dev-service-key",
  },

  // Database Configuration
  database: {
    url: process.env.MONGODB_URL,
  },

  // Main Backend Configuration (for service-to-service communication)
  mainBackend: {
    url: process.env.MAIN_BACKEND_URL || "http://localhost:3000",
  },

  // Stripe Connect Configuration
  connect: {
    defaultCapabilities: ["card_payments", "transfers"],
    accountType: "custom",
    // Note: card_issuing can be requested later via Account update when user needs it
  },

  // Country-specific tax ID formats
  taxIdFormats: {
    US: {
      name: "EIN",
      format: /^\d{2}-\d{7}$/,
      example: "12-3456789",
    },
    GB: {
      name: "VAT Number",
      format: /^GB\d{9}$/,
      example: "GB123456789",
    },
    CA: {
      name: "Business Number",
      format: /^\d{9}$/,
      example: "123456789",
    },
    AU: {
      name: "ABN",
      format: /^\d{2}\s?\d{3}\s?\d{3}\s?\d{3}$/,
      example: "51 824 753 556",
    },
    DE: {
      name: "Steuernummer",
      format: /^\d{2}\/\d{3}\/\d{5}$/,
      example: "12/345/67890",
    },
    FR: {
      name: "SIREN",
      format: /^\d{9}$/,
      example: "123456789",
    },
  },
};
