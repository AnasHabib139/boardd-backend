"use strict";

/**
 * Webhook API Routes
 * Handles incoming webhooks from external services (Twilio, SendGrid)
 * Note: These routes do NOT use Auth middleware (external services call them)
 */

const { Router } = require("express");

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
     */
    router.post("/sms/twilio", handleSmsStatusCallback);

    /**
     * POST /api/webhooks/sms/twilio/inbound
     * Twilio inbound SMS webhook (client replies)
     */
    router.post("/sms/twilio/inbound", handleInboundSms);

    // ==================== TWILIO WHATSAPP WEBHOOKS ====================

    /**
     * POST /api/webhooks/whatsapp/twilio
     * Twilio WhatsApp status callback (delivery updates)
     * Query param: messageId - Internal message ID for status update
     */
    router.post("/whatsapp/twilio", handleWhatsappStatusCallback);

    /**
     * POST /api/webhooks/whatsapp/twilio/inbound
     * Twilio inbound WhatsApp webhook (client replies)
     */
    router.post("/whatsapp/twilio/inbound", handleInboundWhatsapp);

    // ==================== SENDGRID EMAIL WEBHOOKS ====================

    /**
     * POST /api/webhooks/email/sendgrid
     * SendGrid inbound email parse webhook (client email replies)
     * Configure in SendGrid: Settings > Inbound Parse
     */
    router.post("/email/sendgrid", handleInboundEmail);

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
