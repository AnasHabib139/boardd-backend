"use strict";

/**
 * Twilio Webhook Authentication Middleware
 * Verifies webhook signatures to ensure requests come from Twilio
 * Routes webhooks to correct company based on AccountSid or MessagingServiceSid
 *
 * SECURITY CRITICAL: Each subaccount has its own authToken for signature verification
 */

const twilio = require("twilio");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");

/**
 * Verify Twilio webhook signature and identify company
 * Attaches req.twilioCompany for downstream handlers
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next middleware
 */
async function verifyTwilioSignature(req, res, next) {
  try {
    const signature = req.header("X-Twilio-Signature");
    const { AccountSid, MessagingServiceSid, From } = req.body;

    // Validate signature header exists
    if (!signature) {
      console.warn("Twilio webhook rejected: Missing X-Twilio-Signature header");
      return res.status(403).send("Forbidden");
    }

    // Strategy 1: Find company by subaccount SID (most reliable)
    let company = null;
    if (AccountSid) {
      company = await Company.findOne({
        "twilioConfig.subAccountSid": AccountSid,
      }).select("+twilioConfig.authToken");

      if (company) {
        console.log(
          `Twilio webhook routed to company ${company._id} via AccountSid ${AccountSid}`
        );
      }
    }

    // Strategy 2: Find by Messaging Service SID (fallback)
    if (!company && MessagingServiceSid) {
      company = await Company.findOne({
        "twilioConfig.messagingServiceSid": MessagingServiceSid,
      }).select("+twilioConfig.authToken");

      if (company) {
        console.log(
          `Twilio webhook routed to company ${company._id} via MessagingServiceSid ${MessagingServiceSid}`
        );
      }
    }

    // Strategy 3: Find by From number (for direct number sends)
    if (!company && From) {
      const fromNumber = From.replace(/^whatsapp:/, ""); // Remove whatsapp: prefix if present

      company = await Company.findOne({
        $or: [
          { "twilioConfig.fromNumbers": fromNumber },
          { "twilioConfig.whatsappSenders.number": fromNumber },
        ],
      }).select("+twilioConfig.authToken");

      if (company) {
        console.log(
          `Twilio webhook routed to company ${company._id} via From number ${fromNumber}`
        );
      }
    }

    // Fallback to legacy master account
    if (!company) {
      console.log(
        "Twilio webhook: No company matched, attempting legacy account verification"
      );

      const masterAuthToken = process.env.TWILIO_AUTH_TOKEN;
      if (!masterAuthToken) {
        console.error("Legacy Twilio auth token not configured");
        return res.status(500).send("Internal Server Error");
      }

      const url = `${process.env.BACKEND_URL}${req.originalUrl}`;
      const isValid = twilio.validateRequest(
        masterAuthToken,
        signature,
        url,
        req.body
      );

      if (!isValid) {
        console.error("Invalid Twilio signature (legacy account)");
        return res.status(403).send("Forbidden");
      }

      console.log("Twilio webhook verified with legacy account");
      req.twilioCompany = null; // Indicates legacy mode
      return next();
    }

    // Validate signature with subaccount authToken
    if (!company.twilioConfig?.authToken) {
      console.error(
        `Company ${company._id} has no authToken configured for signature verification`
      );
      return res.status(500).send("Internal Server Error");
    }

    const url = `${process.env.BACKEND_URL}${req.originalUrl}`;
    const isValid = twilio.validateRequest(
      company.twilioConfig.authToken,
      signature,
      url,
      req.body
    );

    if (!isValid) {
      console.error(
        `Invalid Twilio signature for company ${company._id}`,
        {
          url,
          accountSid: AccountSid,
          messagingServiceSid: MessagingServiceSid,
        }
      );
      return res.status(403).send("Forbidden");
    }

    // Signature valid - attach company to request
    console.log(
      `Twilio webhook verified successfully for company ${company._id} (${company.name})`
    );
    req.twilioCompany = company;
    next();
  } catch (error) {
    console.error("Webhook signature verification error:", error);
    return res.status(500).send("Internal Server Error");
  }
}

/**
 * Optional middleware: Verify Twilio signature but don't require company match
 * Useful for webhooks that might come from either legacy or multi-tenant setup
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next middleware
 */
async function verifyTwilioSignatureOptional(req, res, next) {
  try {
    const signature = req.header("X-Twilio-Signature");

    if (!signature) {
      console.warn("Twilio webhook: No signature header, skipping verification");
      req.twilioCompany = null;
      return next();
    }

    // Try to verify with company-specific token first
    const { AccountSid, MessagingServiceSid } = req.body;

    if (AccountSid || MessagingServiceSid) {
      // Attempt company lookup and verification
      await verifyTwilioSignature(req, res, next);
      return;
    }

    // Fallback to legacy verification
    const masterAuthToken = process.env.TWILIO_AUTH_TOKEN;
    if (masterAuthToken) {
      const url = `${process.env.BACKEND_URL}${req.originalUrl}`;
      const isValid = twilio.validateRequest(
        masterAuthToken,
        signature,
        url,
        req.body
      );

      if (isValid) {
        req.twilioCompany = null;
        return next();
      }
    }

    console.warn("Twilio webhook signature verification failed (optional mode)");
    req.twilioCompany = null;
    next();
  } catch (error) {
    console.error("Optional webhook verification error:", error);
    req.twilioCompany = null;
    next();
  }
}

module.exports = {
  verifyTwilioSignature,
  verifyTwilioSignatureOptional,
};
