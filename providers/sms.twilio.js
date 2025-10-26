"use strict";

/**
 * Twilio SMS Provider for Client Chat
 * Handles SMS sending via Twilio with status callback support
 * Supports multi-tenant architecture with per-company Twilio clients
 */

const twilio = require("twilio");
const {
  getTwilioClientForCompany,
  getLegacyTwilioClient,
} = require("./twilioClientFactory");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");

// Legacy Twilio client (for backwards compatibility)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
} else {
  console.warn("Twilio credentials not set - SMS sending will fail");
}

/**
 * Send SMS via Twilio (Multi-tenant version)
 * @param {Object} params - SMS parameters
 * @param {String} params.companyId - Company ID (for multi-tenant routing)
 * @param {String} params.to - Recipient phone number (E.164 format)
 * @param {String} params.textContent - SMS message body
 * @param {String} params.messageId - Internal message ID for status callback tracking
 * @returns {Promise<Object>} { success, providerMessageId, status, error, from }
 */
exports.sendSms = async (params) => {
  const { companyId, to, textContent, messageId } = params;

  try {
    // Validate required params
    if (!to || !textContent) {
      throw new Error("Missing required SMS parameters: to, textContent");
    }

    // Validate phone number format (E.164)
    if (!isValidE164(to)) {
      throw new Error(
        `Invalid phone number format. Expected E.164 (e.g., +15551234567), got: ${to}`
      );
    }

    // Get company-specific Twilio client
    let client;
    let company = null;
    let sendingConfig = {};

    if (companyId) {
      // Multi-tenant mode: Use company-specific client
      client = await getTwilioClientForCompany(companyId);
      company = await Company.findById(companyId);

      if (company && company.twilioConfig) {
        // Prefer Messaging Service (load balancing, sticky sender)
        if (company.twilioConfig.messagingServiceSid) {
          sendingConfig.messagingServiceSid =
            company.twilioConfig.messagingServiceSid;
          console.log(
            `Using Messaging Service ${company.twilioConfig.messagingServiceSid} for company ${companyId}`
          );
        } else if (
          company.twilioConfig.fromNumbers &&
          company.twilioConfig.fromNumbers.length > 0
        ) {
          // Fallback to first available number
          sendingConfig.from = company.twilioConfig.fromNumbers[0];
          console.log(
            `Using direct number ${sendingConfig.from} for company ${companyId}`
          );
        } else {
          throw new Error(
            `Company ${companyId} has no phone numbers or messaging service configured`
          );
        }
      } else {
        throw new Error(`Company ${companyId} Twilio config not found`);
      }
    } else {
      // Legacy mode: Use global Twilio client
      client = twilioClient || getLegacyTwilioClient();

      const fromPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
      if (!fromPhoneNumber) {
        throw new Error("TWILIO_PHONE_NUMBER not configured");
      }
      sendingConfig.from = fromPhoneNumber;
      console.log("Using legacy Twilio client for SMS");
    }

    // Validate client
    if (!client) {
      throw new Error("Twilio client not initialized - check credentials");
    }

    // Truncate message if too long (SMS limit is 1600 chars for concatenated messages)
    let messageBody = textContent;
    const MAX_SMS_LENGTH = 1600;
    if (messageBody.length > MAX_SMS_LENGTH) {
      messageBody = messageBody.substring(0, MAX_SMS_LENGTH - 3) + "...";
      console.warn(
        `SMS message truncated from ${textContent.length} to ${MAX_SMS_LENGTH} characters`
      );
    }

    // Build status callback URL (for delivery tracking)
    let statusCallbackUrl = null;
    if (process.env.BACKEND_URL && messageId) {
      statusCallbackUrl = `${process.env.BACKEND_URL}/api/webhooks/sms/twilio?messageId=${messageId}`;
      if (companyId) {
        statusCallbackUrl += `&companyId=${companyId}`;
      }
    }

    // Send SMS via Twilio
    const message = await client.messages.create({
      body: messageBody,
      to: to,
      ...sendingConfig,
      ...(statusCallbackUrl && { statusCallback: statusCallbackUrl }),
    });

    console.log(
      `SMS sent successfully via Twilio to ${to}, SID: ${message.sid}, From: ${message.from}`
    );

    return {
      success: true,
      providerMessageId: message.sid,
      status: mapTwilioStatus(message.status),
      from: message.from,
      sentAt: new Date(),
    };
  } catch (error) {
    console.error("Twilio SMS send error:", error);

    // Extract error message
    let errorMessage = error.message || "Unknown Twilio error";
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
 * Map Twilio message status to our internal status
 * @param {String} twilioStatus - Twilio status (queued, sending, sent, delivered, failed, etc.)
 * @returns {String} Internal status (pending, queued, sent, delivered, failed)
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
    read: "delivered", // WhatsApp feature
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

  // E.164 format: +[country code][subscriber number]
  // Length: 7-15 digits (including country code)
  const e164Regex = /^\+[1-9]\d{6,14}$/;

  return e164Regex.test(phoneNumber);
}

/**
 * Export helper for use in webhooks
 */
exports.mapTwilioStatus = mapTwilioStatus;
exports.isValidE164 = isValidE164;
