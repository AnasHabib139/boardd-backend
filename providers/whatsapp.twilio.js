"use strict";

/**
 * Twilio WhatsApp Provider for Client Chat
 * Handles WhatsApp sending with 24h window enforcement and template support
 */

const twilio = require("twilio");

// Initialize Twilio client
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
 * Send WhatsApp message via Twilio
 * Supports free-form messages (within 24h window) and template messages (outside window)
 * @param {Object} params - WhatsApp parameters
 * @param {String} params.to - Recipient WhatsApp number (E.164 format)
 * @param {String} params.textContent - Message text (for free-form)
 * @param {Object} params.template - Template object (for outside 24h window)
 * @param {String} params.template.name - Template name
 * @param {String} params.template.languageCode - Template language
 * @param {Array} params.template.components - Template components with parameters
 * @param {String} params.messageId - Internal message ID for callback tracking
 * @param {Date} params.lastClientInboundAt - Last inbound message from client
 * @returns {Promise<Object>} { success, providerMessageId, status, error }
 */
exports.sendWhatsapp = async (params) => {
  const { to, textContent, template, messageId, lastClientInboundAt } = params;

  try {
    // Validate required params
    if (!to) {
      throw new Error("Missing required WhatsApp parameter: to");
    }

    // Validate Twilio is configured
    if (!twilioClient) {
      throw new Error("Twilio client not initialized - check credentials");
    }

    const fromWhatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!fromWhatsappNumber) {
      throw new Error("TWILIO_WHATSAPP_NUMBER not configured");
    }

    // Validate phone number format (E.164)
    if (!isValidE164(to)) {
      throw new Error(`Invalid WhatsApp number format. Expected E.164 (e.g., +15551234567), got: ${to}`);
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
    const statusCallbackUrl = process.env.BACKEND_URL
      ? `${process.env.BACKEND_URL}/api/webhooks/whatsapp/twilio?messageId=${messageId}`
      : null;

    let message;

    if (isTemplateMode) {
      // Send template message (outside 24h window)
      message = await sendTemplateMessage({
        to,
        from: fromWhatsappNumber,
        template,
        statusCallbackUrl,
      });
    } else {
      // Send free-form message (within 24h window)
      message = await sendFreeFormMessage({
        to,
        from: fromWhatsappNumber,
        textContent,
        statusCallbackUrl,
      });
    }

    console.log(`WhatsApp sent successfully via Twilio to ${to}, SID: ${message.sid}`);

    return {
      success: true,
      providerMessageId: message.sid,
      status: mapTwilioStatus(message.status),
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
async function sendFreeFormMessage({ to, from, textContent, statusCallbackUrl }) {
  if (!textContent) {
    throw new Error("textContent required for free-form WhatsApp message");
  }

  // Format WhatsApp numbers with whatsapp: prefix
  const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const formattedFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

  return twilioClient.messages.create({
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
async function sendTemplateMessage({ to, from, template, statusCallbackUrl }) {
  if (!template || !template.name || !template.languageCode) {
    throw new Error("Template name and languageCode required for template message");
  }

  // Format WhatsApp numbers
  const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const formattedFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

  // Build Content API template structure
  const contentSid = await getTemplateContentSid(template.name, template.languageCode);

  if (!contentSid) {
    throw new Error(`Template not found or not approved: ${template.name} (${template.languageCode})`);
  }

  // Send via Twilio Content API
  return twilioClient.messages.create({
    from: formattedFrom,
    to: formattedTo,
    contentSid: contentSid,
    contentVariables: buildContentVariables(template.components),
    ...(statusCallbackUrl && { statusCallback: statusCallbackUrl }),
  });
}

/**
 * Get Twilio Content SID for template
 * @param {String} templateName - Template name
 * @param {String} languageCode - Language code
 * @returns {Promise<String|null>} Content SID or null
 */
async function getTemplateContentSid(templateName, languageCode) {
  // TODO: Implement template SID lookup from config or Twilio API
  // For now, assume templates are pre-configured in config/whatsappTemplates.js
  const whatsappTemplates = require("../config/whatsappTemplates");

  const template = whatsappTemplates.templates?.find(
    (t) => t.name === templateName && t.languageCode === languageCode
  );

  return template?.contentSid || null;
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
