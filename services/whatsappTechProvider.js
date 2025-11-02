"use strict";

/**
 * WhatsApp Tech Provider Service
 *
 * Implements Meta's Tech Provider Program integration via Twilio
 * - Handles Meta Embedded Signup for customer WABA creation
 * - Registers WhatsApp senders using Twilio Senders API
 * - Manages multi-tenant WhatsApp with separate WABAs per customer
 *
 * Key Architecture:
 * 1. Customer completes Embedded Signup → Creates their own WABA
 * 2. ISV receives WABA ID in OAuth callback
 * 3. ISV registers sender via Twilio Senders API using subaccount credentials
 * 4. Each customer has isolated WABA + Twilio subaccount
 *
 * Reference: https://www.twilio.com/docs/whatsapp/isv/tech-provider-program
 */

const crypto = require("crypto");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");

// Environment configuration
const META_APP_ID = process.env.META_APP_ID; // Your Meta App ID (from Tech Provider setup)
const META_APP_SECRET = process.env.META_APP_SECRET; // Your Meta App Secret
const BACKEND_URL = process.env.BACKEND_URL || "https://boarddd.ddns.net";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://boarddd-frontend-murex.vercel.app";

// OAuth state token storage (use Redis in production for scalability)
const stateTokenStore = new Map();

/**
 * Generate OAuth URL for Meta Embedded Signup
 * Customer will use this to create their WABA and grant permissions
 *
 * @param {string} companyId - Company MongoDB ID
 * @param {string} businessName - Company's business name
 * @param {string} phoneNumber - Phone number to register (optional, for pre-selection)
 * @returns {Promise<{authUrl: string, state: string}>}
 */
exports.generateEmbeddedSignupUrl = async (companyId, businessName, phoneNumber = null) => {
  try {
    // Generate secure state token for CSRF protection
    const stateToken = crypto.randomBytes(32).toString("hex");
    const stateData = {
      companyId,
      businessName,
      phoneNumber,
      timestamp: Date.now(),
    };

    // Store state (expires in 30 minutes)
    stateTokenStore.set(stateToken, stateData);
    setTimeout(() => stateTokenStore.delete(stateToken), 30 * 60 * 1000);

    // Build Meta Embedded Signup URL
    const callbackUrl = `${BACKEND_URL}/api/messaging/whatsapp/embedded-signup/callback`;

    const params = new URLSearchParams({
      client_id: META_APP_ID,
      redirect_uri: callbackUrl,
      state: stateToken,
      response_type: "code",
      scope: "whatsapp_business_management,whatsapp_business_messaging",
      // Config ID from your Meta Tech Provider setup (required)
      config_id: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    });

    // Add business name as setup parameter (pre-fill for customer)
    if (businessName) {
      params.append("setup[business_name]", businessName);
    }

    // Add phone number as setup parameter (pre-select for customer)
    if (phoneNumber) {
      // Remove + prefix for Meta API
      const cleanPhone = phoneNumber.replace(/^\+/, "");
      params.append("setup[phone_number]", cleanPhone);
    }

    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;

    console.log(`✓ Generated Embedded Signup URL for company ${companyId}`);

    return {
      authUrl,
      state: stateToken,
    };
  } catch (error) {
    console.error("Error generating Embedded Signup URL:", error);
    throw new Error(`Failed to generate Embedded Signup URL: ${error.message}`);
  }
};

/**
 * Verify OAuth state token
 *
 * @param {string} state - State token from OAuth callback
 * @returns {Promise<{companyId: string, businessName: string, phoneNumber: string|null}>}
 */
exports.verifyStateToken = async (state) => {
  const stateData = stateTokenStore.get(state);

  if (!stateData) {
    throw new Error("Invalid or expired state token. Please restart the WhatsApp setup.");
  }

  // Check expiration (30 minutes)
  if (Date.now() - stateData.timestamp > 30 * 60 * 1000) {
    stateTokenStore.delete(state);
    throw new Error("State token expired. Please restart the WhatsApp setup.");
  }

  return stateData;
};

/**
 * Handle Embedded Signup callback
 * Store WABA ID returned by Meta after customer completes signup
 *
 * Note: In Tech Provider Program, we don't exchange code for token.
 * Meta returns WABA ID in the callback, which is all we need.
 *
 * @param {string} code - Authorization code (not used in Tech Provider)
 * @param {string} wabaId - WABA ID from Meta callback
 * @param {string} businessId - Business Portfolio ID from Meta
 * @param {string} companyId - Company MongoDB ID
 * @returns {Promise<void>}
 */
exports.handleEmbeddedSignupCallback = async (code, wabaId, businessId, companyId) => {
  try {
    if (!wabaId) {
      throw new Error("No WABA ID provided in callback. Embedded Signup may have failed.");
    }

    console.log(`→ Storing WABA ${wabaId} for company ${companyId}`);

    // Store WABA information in database
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "whatsappTechProvider.wabaId": wabaId,
        "whatsappTechProvider.businessPortfolioId": businessId,
        "whatsappTechProvider.signupCompleted": true,
        "whatsappTechProvider.signupCompletedAt": new Date(),
      },
    });

    console.log(`✓ WABA ${wabaId} stored successfully for company ${companyId}`);
  } catch (error) {
    console.error("Error handling Embedded Signup callback:", error);
    throw new Error(`Failed to process Embedded Signup: ${error.message}`);
  }
};

/**
 * Register WhatsApp sender using Twilio Senders API
 * This is called after customer completes Embedded Signup
 *
 * Uses subaccount credentials for multi-tenant isolation
 *
 * @param {string} companyId - Company MongoDB ID
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., '+15551234567')
 * @param {string} displayName - Business display name for WhatsApp
 * @returns {Promise<{senderSid: string, status: string}>}
 */
exports.registerWhatsappSender = async (companyId, phoneNumber, displayName) => {
  try {
    const company = await Company.findById(companyId).select("twilioConfig whatsappTechProvider");

    if (!company) {
      throw new Error("Company not found");
    }

    // Verify WABA exists (customer must complete Embedded Signup first)
    if (!company.whatsappTechProvider?.wabaId) {
      throw new Error(
        "No WABA found. Customer must complete Embedded Signup first before registering senders."
      );
    }

    // Get subaccount credentials
    const subAccountSid = company.twilioConfig?.subAccountSid;
    const apiKeySid = company.twilioConfig?.apiKeySid;
    const apiKeySecret = company.twilioConfig?.apiKeySecret; // This is encrypted in DB

    if (!subAccountSid || !apiKeySid || !apiKeySecret) {
      throw new Error("Twilio subaccount not configured. Please provision SMS first.");
    }

    // Initialize Twilio client with subaccount credentials
    const accountSid = subAccountSid;
    const authToken = apiKeySecret; // Decrypt if using encryption
    const client = require("twilio")(apiKeySid, apiKeySecret, { accountSid });

    // Format phone number for WhatsApp (add 'whatsapp:' prefix)
    const twilioNumber = `whatsapp:${phoneNumber}`;

    console.log(`→ Registering WhatsApp sender ${phoneNumber} for company ${companyId}`);

    // Call Twilio Senders API
    // POST https://messaging.twilio.com/v2/Channels/Senders
    const sender = await client.messaging.v2.services
      .create({
        senderId: twilioNumber,
        senderType: "whatsapp",
        attributes: JSON.stringify({
          displayName: displayName,
          wabaId: company.whatsappTechProvider.wabaId,
        }),
      });

    console.log(`✓ WhatsApp sender registered: ${sender.sid}`);

    // Store sender information in database
    await Company.findByIdAndUpdate(companyId, {
      $push: {
        "whatsappTechProvider.senders": {
          phoneNumber: phoneNumber,
          twilioNumber: twilioNumber,
          senderSid: sender.sid,
          displayName: displayName,
          status: "pending", // Will be updated by status check
          registeredAt: new Date(),
        },
      },
      $set: {
        "whatsappTechProvider.active": true,
      },
    });

    return {
      senderSid: sender.sid,
      status: sender.status || "pending",
      message: "WhatsApp sender registration initiated. Status will be updated once verified by Meta.",
    };
  } catch (error) {
    console.error("Error registering WhatsApp sender:", error);

    // Store failure in database
    await Company.findByIdAndUpdate(companyId, {
      $push: {
        "whatsappTechProvider.senders": {
          phoneNumber: phoneNumber,
          twilioNumber: `whatsapp:${phoneNumber}`,
          displayName: displayName,
          status: "failed",
          failedReason: error.message,
          registeredAt: new Date(),
        },
      },
    });

    throw new Error(`Failed to register WhatsApp sender: ${error.message}`);
  }
};

/**
 * Get WhatsApp sender status from Twilio
 *
 * @param {string} companyId - Company MongoDB ID
 * @param {string} phoneNumber - Phone number to check status
 * @returns {Promise<{status: string, statusDetails: string}>}
 */
exports.getWhatsappSenderStatus = async (companyId, phoneNumber) => {
  try {
    const company = await Company.findById(companyId).select("twilioConfig whatsappTechProvider");

    if (!company) {
      throw new Error("Company not found");
    }

    // Find sender in database
    const sender = company.whatsappTechProvider?.senders?.find(
      (s) => s.phoneNumber === phoneNumber
    );

    if (!sender) {
      throw new Error(`WhatsApp sender ${phoneNumber} not found`);
    }

    if (!sender.senderSid) {
      return {
        status: sender.status,
        statusDetails: sender.failedReason || "Registration failed",
      };
    }

    // Get subaccount credentials
    const subAccountSid = company.twilioConfig?.subAccountSid;
    const apiKeySid = company.twilioConfig?.apiKeySid;
    const apiKeySecret = company.twilioConfig?.apiKeySecret;

    if (!subAccountSid || !apiKeySid || !apiKeySecret) {
      throw new Error("Twilio subaccount not configured");
    }

    // Initialize Twilio client
    const accountSid = subAccountSid;
    const client = require("twilio")(apiKeySid, apiKeySecret, { accountSid });

    // Fetch sender status from Twilio
    const senderResource = await client.messaging.v2.services(sender.senderSid).fetch();

    // Update status in database
    await Company.findOneAndUpdate(
      {
        _id: companyId,
        "whatsappTechProvider.senders.phoneNumber": phoneNumber,
      },
      {
        $set: {
          "whatsappTechProvider.senders.$.status": senderResource.status,
          "whatsappTechProvider.senders.$.statusDetails": senderResource.statusDetails || "",
          "whatsappTechProvider.senders.$.lastStatusCheck": new Date(),
        },
      }
    );

    return {
      status: senderResource.status,
      statusDetails: senderResource.statusDetails || "",
    };
  } catch (error) {
    console.error("Error getting WhatsApp sender status:", error);
    throw new Error(`Failed to get sender status: ${error.message}`);
  }
};

/**
 * List all WhatsApp senders for a company
 *
 * @param {string} companyId - Company MongoDB ID
 * @returns {Promise<Array>}
 */
exports.listWhatsappSenders = async (companyId) => {
  try {
    const company = await Company.findById(companyId).select("whatsappTechProvider");

    if (!company) {
      throw new Error("Company not found");
    }

    return {
      wabaId: company.whatsappTechProvider?.wabaId || null,
      signupCompleted: company.whatsappTechProvider?.signupCompleted || false,
      senders: company.whatsappTechProvider?.senders || [],
      active: company.whatsappTechProvider?.active || false,
    };
  } catch (error) {
    console.error("Error listing WhatsApp senders:", error);
    throw new Error(`Failed to list senders: ${error.message}`);
  }
};
