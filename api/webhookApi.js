"use strict";

/**
 * Webhook API Routes
 * Handles incoming webhooks from external services (Twilio, SendGrid)
 * Note: These routes do NOT use Auth middleware (external services call them)
 */

const { Router } = require("express");
const multer = require("multer");

// Configure multer for parsing multipart/form-data (SendGrid sends this format)
const upload = multer();

// Import Twilio webhook authentication middleware
const {
  verifyTwilioSignature,
} = require("../middlewares/twilioWebhookAuth");

// Import webhook controllers
const {
  handleSmsStatusCallback,
  handleInboundSms,
} = require("../controller/webhooks/twilioSms.controller");

const {
  handleWhatsappStatusCallback,
  handleInboundWhatsapp,
} = require("../controller/webhooks/twilioWhatsapp.controller");

const {
  handleInboundEmail,
} = require("../controller/webhooks/sendgridInbound.controller");

class WebhookApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // ==================== TWILIO SMS WEBHOOKS ====================

    /**
     * POST /api/webhooks/sms/twilio
     * Twilio SMS status callback (delivery updates)
     * Query param: messageId - Internal message ID for status update
     * Middleware: verifyTwilioSignature - validates webhook signature and routes to company
     */
    router.post("/sms/twilio", verifyTwilioSignature, handleSmsStatusCallback);

    /**
     * POST /api/webhooks/sms/twilio/inbound
     * Twilio inbound SMS webhook (client replies)
     * Middleware: verifyTwilioSignature - validates webhook signature and routes to company
     */
    router.post("/sms/twilio/inbound", verifyTwilioSignature, handleInboundSms);

    // ==================== TWILIO WHATSAPP WEBHOOKS ====================

    /**
     * POST /api/webhooks/whatsapp/twilio
     * Twilio WhatsApp status callback (delivery updates)
     * Query param: messageId - Internal message ID for status update
     * Middleware: verifyTwilioSignature - validates webhook signature and routes to company
     */
    router.post("/whatsapp/twilio", verifyTwilioSignature, handleWhatsappStatusCallback);

    /**
     * POST /api/webhooks/whatsapp/twilio/inbound
     * Twilio inbound WhatsApp webhook (client replies)
     * Middleware: verifyTwilioSignature - validates webhook signature and routes to company
     */
    router.post("/whatsapp/twilio/inbound", verifyTwilioSignature, handleInboundWhatsapp);

    // ==================== SENDGRID EMAIL WEBHOOKS ====================

    /**
     * POST /api/webhooks/email/sendgrid
     * SendGrid inbound email parse webhook (client email replies)
     * Configure in SendGrid: Settings > Inbound Parse
     *
     * SendGrid sends data as multipart/form-data, so we use multer to parse it
     */
    router.post(
      "/email/sendgrid",
      upload.none(), // Parse multipart/form-data (no file uploads, only text fields)
      handleInboundEmail
    );

    /**
     * POST /api/webhooks/email/sendgrid/events
     * SendGrid event webhook (delivery status, opens, clicks, bounces)
     * TODO: Implement if needed for email delivery tracking
     * Configure in SendGrid: Settings > Mail Settings > Event Webhook
     */
    router.post("/email/sendgrid/events", (req, res) => {
      // Placeholder for SendGrid event webhook
      // Can be used to track email opens, clicks, bounces, etc.
      console.log("SendGrid event webhook (not implemented):", req.body);
      res.status(200).send("OK");
    });
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/webhooks";
  }
}

module.exports = WebhookApi;
