"use strict";

/**
 * Twilio WhatsApp Provider for Client Chat
 * Handles WhatsApp sending with 24h window enforcement and template support
 * Supports multi-tenant architecture with per-company Twilio clients
 */

const twilio = require("twilio");
const {
  getTwilioClientForCompany,
  getLegacyTwilioClient,
} = require("./twilioClientFactory");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");
// Require model file to register it with Mongoose
require("../models/whatsappTemplateModel");

// Legacy Twilio client (for backwards compatibility)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
} else {
  console.warn("Twilio credentials not set - WhatsApp sending will fail");
}

/**
 * Send WhatsApp message via Twilio (Multi-tenant version)
 * Supports free-form messages (within 24h window) and template messages (outside window)
 * @param {Object} params - WhatsApp parameters
 * @param {String} params.companyId - Company ID (for multi-tenant routing)
 * @param {String} params.to - Recipient WhatsApp number (E.164 format)
 * @param {String} params.textContent - Message text (for free-form)
 * @param {Object} params.template - Template object (for outside 24h window)
 * @param {String} params.template.name - Template name
 * @param {String} params.template.languageCode - Template language
 * @param {Array} params.template.components - Template components with parameters
 * @param {String} params.messageId - Internal message ID for callback tracking
 * @param {Date} params.lastClientInboundAt - Last inbound message from client
 * @returns {Promise<Object>} { success, providerMessageId, status, error, from }
 */
exports.sendWhatsapp = async (params) => {
  const { companyId, to, textContent, template, messageId, lastClientInboundAt } = params;

  try {
    // Validate required params
    if (!to) {
      throw new Error("Missing required WhatsApp parameter: to");
    }

    // Validate phone number format (E.164)
    if (!isValidE164(to)) {
      throw new Error(
        `Invalid WhatsApp number format. Expected E.164 (e.g., +15551234567), got: ${to}`
      );
    }

    // Get company-specific Twilio client and WhatsApp sender
    let client;
    let company = null;
    let fromWhatsappNumber;

    if (companyId) {
      // Multi-tenant mode: Use company-specific client
      client = await getTwilioClientForCompany(companyId);
      company = await Company.findById(companyId);

      if (!company || !company.twilioConfig) {
        throw new Error(`Company ${companyId} Twilio config not found`);
      }

      // Find active WhatsApp sender
      const activeSender = company.twilioConfig.whatsappSenders?.find(
        (s) => s.status === "active"
      );

      if (!activeSender) {
        throw new Error(
          `Company ${companyId} has no active WhatsApp sender configured`
        );
      }

      fromWhatsappNumber = activeSender.twilioNumber || activeSender.number;
      console.log(
        `Using WhatsApp sender ${fromWhatsappNumber} for company ${companyId}`
      );
    } else {
      // Legacy mode: Use global Twilio client
      client = twilioClient || getLegacyTwilioClient();
      fromWhatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;

      if (!fromWhatsappNumber) {
        throw new Error("TWILIO_WHATSAPP_NUMBER not configured");
      }
      console.log("Using legacy Twilio client for WhatsApp");
    }

    // Validate client
    if (!client) {
      throw new Error("Twilio client not initialized - check credentials");
    }

    // Check if within 24-hour window
    const isWithin24Hours = checkWithin24HourWindow(lastClientInboundAt);

    // Determine send mode
    const isFreeForm = !template && textContent;
    const isTemplateMode = !!template;

    // Enforce 24h window rule
    if (isFreeForm && !isWithin24Hours) {
      throw new Error(
        "Free-form WhatsApp messages are only allowed within 24 hours of last client message. " +
          "Please use a template message or wait for client to reply."
      );
    }

    // Build status callback URL
    let statusCallbackUrl = null;
    if (process.env.BACKEND_URL && messageId) {
      statusCallbackUrl = `${process.env.BACKEND_URL}/api/webhooks/whatsapp/twilio?messageId=${messageId}`;
      if (companyId) {
        statusCallbackUrl += `&companyId=${companyId}`;
      }
    }

    let message;

    if (isTemplateMode) {
      // Send template message (outside 24h window)
      message = await sendTemplateMessage({
        client,
        companyId,
        to,
        from: fromWhatsappNumber,
        template,
        statusCallbackUrl,
      });
    } else {
      // Send free-form message (within 24h window)
      message = await sendFreeFormMessage({
        client,
        to,
        from: fromWhatsappNumber,
        textContent,
        statusCallbackUrl,
      });
    }

    console.log(
      `WhatsApp sent successfully via Twilio to ${to}, SID: ${message.sid}, From: ${message.from}`
    );

    return {
      success: true,
      providerMessageId: message.sid,
      status: mapTwilioStatus(message.status),
      from: message.from,
      sentAt: new Date(),
    };
  } catch (error) {
    console.error("Twilio WhatsApp send error:", error);

    // Extract error message
    let errorMessage = error.message || "Unknown Twilio WhatsApp error";
    if (error.code) {
      errorMessage = `Twilio Error ${error.code}: ${error.message}`;
    }

    return {
      success: false,
      status: "failed",
      error: errorMessage,
    };
  }
};

/**
 * Send free-form WhatsApp message (within 24h window)
 * @param {Object} params
 * @returns {Promise<Object>} Twilio message object
 */
async function sendFreeFormMessage({ client, to, from, textContent, statusCallbackUrl }) {
  if (!textContent) {
    throw new Error("textContent required for free-form WhatsApp message");
  }

  // Format WhatsApp numbers with whatsapp: prefix
  const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const formattedFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

  return client.messages.create({
    body: textContent,
    from: formattedFrom,
    to: formattedTo,
    ...(statusCallbackUrl && { statusCallback: statusCallbackUrl }),
  });
}

/**
 * Send WhatsApp template message (outside 24h window)
 * @param {Object} params
 * @returns {Promise<Object>} Twilio message object
 */
async function sendTemplateMessage({ client, companyId, to, from, template, statusCallbackUrl }) {
  if (!template || !template.name || !template.languageCode) {
    throw new Error("Template name and languageCode required for template message");
  }

  // Format WhatsApp numbers
  const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const formattedFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

  // Get template from database
  const contentSid = await getTemplateContentSid(
    companyId,
    template.name,
    template.languageCode
  );

  if (!contentSid) {
    throw new Error(
      `Template not found or not approved: ${template.name} (${template.languageCode})`
    );
  }

  // Send via Twilio Content API
  return client.messages.create({
    from: formattedFrom,
    to: formattedTo,
    contentSid: contentSid,
    contentVariables: buildContentVariables(template.components),
    ...(statusCallbackUrl && { statusCallback: statusCallbackUrl }),
  });
}

/**
 * Get Twilio Content SID for template from database
 * @param {String} companyId - Company ID
 * @param {String} templateName - Template name
 * @param {String} languageCode - Language code
 * @returns {Promise<String|null>} Content SID or null
 */
async function getTemplateContentSid(companyId, templateName, languageCode) {
  try {
    // Lazy-load WhatsAppTemplate model to avoid loading order issues
    const WhatsAppTemplate = mongooseModel("WhatsAppTemplate");

    // Look up template from database
    const template = await WhatsAppTemplate.findOne({
      companyId,
      name: templateName,
      language: languageCode,
      status: "approved",
    });

    if (template && template.twilioContentSid) {
      console.log(
        `Found template ${templateName} (${languageCode}) with ContentSid ${template.twilioContentSid}`
      );
      return template.twilioContentSid;
    }

    // Fallback to hardcoded config if database lookup fails
    try {
      const whatsappTemplates = require("../config/whatsappTemplates");
      const configTemplate = whatsappTemplates.templates?.find(
        (t) => t.name === templateName && t.languageCode === languageCode
      );
      return configTemplate?.contentSid || null;
    } catch (configError) {
      // Config file doesn't exist yet
      console.warn("WhatsApp templates config file not found, using DB only");
      return null;
    }
  } catch (error) {
    console.error("Error looking up WhatsApp template:", error);
    return null;
  }
}

/**
 * Build content variables JSON from template components
 * @param {Array} components - Template components array
 * @returns {String} JSON string of variables
 */
function buildContentVariables(components) {
  if (!components || !Array.isArray(components)) {
    return JSON.stringify({});
  }

  const variables = {};

  components.forEach((component, index) => {
    if (component.type === "body" && component.parameters) {
      component.parameters.forEach((param, paramIndex) => {
        // Twilio Content API expects variables like: { "1": "value1", "2": "value2" }
        variables[String(paramIndex + 1)] = param.text || param.value || "";
      });
    }
  });

  return JSON.stringify(variables);
}

/**
 * Check if current time is within 24-hour customer care window
 * @param {Date|null} lastClientInboundAt - Last inbound message timestamp
 * @returns {Boolean} True if within 24 hours
 */
function checkWithin24HourWindow(lastClientInboundAt) {
  if (!lastClientInboundAt) {
    return false; // No previous client message = outside window
  }

  const lastInbound = new Date(lastClientInboundAt);
  const now = new Date();
  const hoursSinceLastInbound = (now - lastInbound) / (1000 * 60 * 60);

  return hoursSinceLastInbound < 24;
}

/**
 * Map Twilio message status to our internal status
 * @param {String} twilioStatus - Twilio status
 * @returns {String} Internal status
 */
function mapTwilioStatus(twilioStatus) {
  const statusMap = {
    queued: "queued",
    sending: "queued",
    sent: "sent",
    delivered: "delivered",
    undelivered: "failed",
    failed: "failed",
    accepted: "queued",
    scheduled: "pending",
    read: "delivered",
    received: "delivered",
  };

  return statusMap[twilioStatus?.toLowerCase()] || "pending";
}

/**
 * Validate E.164 phone number format
 * @param {String} phoneNumber - Phone number to validate
 * @returns {Boolean} True if valid E.164 format
 */
function isValidE164(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== "string") return false;

  // Remove whatsapp: prefix if present
  const cleanNumber = phoneNumber.replace(/^whatsapp:/, "");

  // E.164 format: +[country code][subscriber number]
  const e164Regex = /^\+[1-9]\d{6,14}$/;

  return e164Regex.test(cleanNumber);
}

/**
 * Export helpers for use in other modules
 */
exports.checkWithin24HourWindow = checkWithin24HourWindow;
exports.mapTwilioStatus = mapTwilioStatus;
exports.isValidE164 = isValidE164;
