"use strict";

/**
 * Webhooks Controller
 * Handles incoming webhooks from third-party services
 * - Twilio SMS webhooks
 * - Meta WhatsApp webhooks
 */

const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");
const metaEmbeddedSignup = require("../services/metaEmbeddedSignup");
const twilio = require("twilio");

/**
 * Twilio SMS Webhook Handler
 * Receives incoming SMS messages and auto-verifies Meta WhatsApp pre-verified phone numbers
 *
 * POST /api/webhooks/twilio-sms
 * No authentication - Twilio signature validation used instead
 *
 * Expected body from Twilio:
 * - From: Sender phone number
 * - To: Receiving phone number (our Twilio number)
 * - Body: SMS message content
 * - MessageSid: Twilio message SID
 */
exports.twilioSmsWebhook = async (req, res, next) => {
  try {
    console.log("→ Twilio SMS webhook received");

    // Validate Twilio request signature for security
    const twilioSignature = req.headers['x-twilio-signature'];
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const requestIsValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      req.body
    );

    if (!requestIsValid) {
      console.error("⚠ Invalid Twilio signature");
      return res.status(403).send("Forbidden");
    }

    const { From, To, Body, MessageSid } = req.body;

    console.log(`  → SMS from: ${From} to: ${To}`);
    console.log(`  → Message: ${Body}`);

    // Check if this is a Meta verification code
    const isMetaVerification = (
      Body.includes('WhatsApp') ||
      Body.includes('Facebook') ||
      Body.includes('Meta') ||
      Body.includes('verification') ||
      Body.includes('code') ||
      /\b\d{6}\b/.test(Body) // Contains 6-digit code
    );

    if (!isMetaVerification) {
      console.log("  → Not a Meta verification SMS, ignoring");
      return res.status(200).send("<Response></Response>");
    }

    // Extract 6-digit verification code
    const codeMatch = Body.match(/\b(\d{6})\b/);
    if (!codeMatch) {
      console.log("  → No 6-digit code found in message");
      return res.status(200).send("<Response></Response>");
    }

    const verificationCode = codeMatch[1];
    console.log(`  → Extracted verification code: ${verificationCode}`);

    // Find company with this Twilio number awaiting verification
    const company = await Company.findOne({
      "whatsappEmbeddedSignup.preVerifiedPhones": {
        $elemMatch: {
          phoneNumber: To,
          verificationStatus: { $in: ['pending', 'code_sent'] }
        }
      }
    });

    if (!company) {
      console.log("  → No pending verification found for this number");
      return res.status(200).send("<Response></Response>");
    }

    const pendingPhone = company.whatsappEmbeddedSignup.preVerifiedPhones.find(
      p => p.phoneNumber === To && ['pending', 'code_sent'].includes(p.verificationStatus)
    );

    if (!pendingPhone) {
      console.log("  → No pending phone record found");
      return res.status(200).send("<Response></Response>");
    }

    console.log(`  → Found pending verification for company: ${company.name} (${company._id})`);
    console.log(`  → Pre-verified phone ID: ${pendingPhone.preVerifiedPhoneId}`);

    // Update status to code_sent
    await Company.findOneAndUpdate(
      {
        _id: company._id,
        "whatsappEmbeddedSignup.preVerifiedPhones.preVerifiedPhoneId": pendingPhone.preVerifiedPhoneId
      },
      {
        $set: {
          "whatsappEmbeddedSignup.preVerifiedPhones.$.verificationStatus": 'code_sent',
          "whatsappEmbeddedSignup.preVerifiedPhones.$.verificationCode": verificationCode
        }
      }
    );

    // Auto-verify with Meta
    try {
      const result = await metaEmbeddedSignup.verifyPhoneCode(
        company._id.toString(),
        pendingPhone.preVerifiedPhoneId,
        verificationCode
      );

      console.log(`✓ Phone number auto-verified successfully: ${result.phoneNumber}`);

    } catch (verifyError) {
      console.error("✗ Auto-verification failed:", verifyError.message);
      // Don't fail the webhook - Twilio expects 200 OK
    }

    // Respond to Twilio with empty TwiML
    return res.status(200).send("<Response></Response>");

  } catch (error) {
    console.error("Error handling Twilio SMS webhook:", error);

    // IMPORTANT: Always return 200 to Twilio to prevent retries
    return res.status(200).send("<Response></Response>");
  }
};

/**
 * Meta WhatsApp Webhook Handler
 * Receives webhook events from Meta (message status, incoming messages, etc.)
 *
 * This endpoint is already implemented in messagingConfig.controller.js
 * as whatsappEmbeddedSignupCallback (handles both webhook verification and OAuth)
 */
