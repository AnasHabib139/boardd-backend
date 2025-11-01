"use strict";

/**
 * Messaging Configuration API Routes
 *
 * REST API for company admins to configure SMS, WhatsApp, and Email
 * All routes require authentication and company admin permissions
 *
 * Base path: /api/messaging
 */

const { Router } = require("express");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { requireCompanyAdmin, requireCompanyAccess } = require("../middlewares/companyAdminAuth");
const controller = require("../controller/messagingConfig.controller");

class MessagingConfigApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    const router = this.router;

    // ==================== SMS CONFIGURATION ====================

    /**
     * POST /api/messaging/sms/provision
     * Create Twilio subaccount for company
     * Required: company admin
     */
    router.post(
      "/sms/provision",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.provisionSmsSubaccount
    );

    /**
     * GET /api/messaging/sms/available-numbers
     * Search for available phone numbers
     * Query params: areaCode (required), country (optional, default: US)
     * Required: company admin
     */
    router.get(
      "/sms/available-numbers",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.searchPhoneNumbers
    );

    /**
     * POST /api/messaging/sms/purchase
     * Purchase a phone number for SMS
     * Body: { phoneNumber, type: "sms" }
     * Required: company admin
     */
    router.post(
      "/sms/purchase",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.purchasePhoneNumber
    );

    /**
     * POST /api/messaging/sms/messaging-service
     * Create messaging service (load balancing, sticky sender)
     * Required: company admin
     */
    router.post(
      "/sms/messaging-service",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.createMessagingService
    );

    /**
     * POST /api/messaging/sms/test
     * Send test SMS
     * Body: { to, message }
     * Required: company admin
     */
    router.post(
      "/sms/test",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.sendTestSms
    );

    // ==================== WHATSAPP CONFIGURATION ====================

    /**
     * POST /api/messaging/whatsapp/provision
     * Configure WhatsApp for company
     * Body: { businessName, businessCategory, phoneNumber }
     * Required: company admin
     */
    router.post(
      "/whatsapp/provision",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.provisionWhatsapp
    );

    /**
     * POST /api/messaging/whatsapp/templates
     * Create WhatsApp template
     * Body: { name, language, category, components }
     * Required: company admin
     */
    router.post(
      "/whatsapp/templates",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.createWhatsappTemplate
    );

    /**
     * GET /api/messaging/whatsapp/templates
     * List WhatsApp templates
     * Query params: status (optional), category (optional)
     * Required: company access (any team member)
     */
    router.get(
      "/whatsapp/templates",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAccess,
      controller.listWhatsappTemplates
    );

    /**
     * GET /api/messaging/whatsapp/templates/:templateId
     * Get single WhatsApp template
     * Required: company access
     */
    router.get(
      "/whatsapp/templates/:templateId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAccess,
      controller.getWhatsappTemplate
    );

    /**
     * DELETE /api/messaging/whatsapp/templates/:templateId
     * Delete WhatsApp template
     * Required: company admin
     */
    router.delete(
      "/whatsapp/templates/:templateId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.deleteWhatsappTemplate
    );

    // ==================== EMAIL CONFIGURATION ====================

    /**
     * POST /api/messaging/email/configure
     * Configure email sender
     * Body: { fromEmail, fromName, replyTo }
     * Required: company admin
     */
    router.post(
      "/email/configure",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.configureEmail
    );

    /**
     * GET /api/messaging/email/verification-status
     * Check email verification status
     * Required: company access
     */
    router.get(
      "/email/verification-status",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAccess,
      controller.getEmailVerificationStatus
    );

    /**
     * GET /api/messaging/email/dns-records
     * Get DNS records for inbound email
     * Required: company admin
     */
    router.get(
      "/email/dns-records",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.getEmailDnsRecords
    );

    /**
     * POST /api/messaging/email/verify-domain
     * Manually verify domain authentication (for "Verify DNS" button)
     * Checks if DNS records have been added and domain is authenticated
     * Required: company admin
     */
    router.post(
      "/email/verify-domain",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.verifyEmailDomain
    );

    /**
     * POST /api/messaging/email/test
     * Send test email
     * Body: { to } (optional, defaults to fromEmail)
     * Required: company admin
     */
    router.post(
      "/email/test",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.sendTestEmail
    );

    // ==================== INBOUND EMAIL CONFIGURATION ====================

    /**
     * POST /api/messaging/email/register-inbound
     * Register inbound parse webhook with SendGrid
     * Enables receiving email replies via company's custom subdomain
     * Required: company admin
     */
    router.post(
      "/email/register-inbound",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.registerInboundParse
    );

    /**
     * GET /api/messaging/email/verify-inbound-mx
     * Verify MX record for inbound subdomain
     * Checks DNS to ensure MX record is properly configured
     * Required: company access
     */
    router.get(
      "/email/verify-inbound-mx",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAccess,
      controller.verifyInboundMxRecord
    );

    /**
     * GET /api/messaging/email/inbound-status
     * Get inbound email configuration status
     * Returns registration status and MX record verification
     * Required: company access
     */
    router.get(
      "/email/inbound-status",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAccess,
      controller.getInboundStatus
    );

    // ==================== OVERALL STATUS ====================

    /**
     * GET /api/messaging/status
     * Get overall messaging configuration status
     * Required: company access
     */
    router.get(
      "/status",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAccess,
      controller.getMessagingStatus
    );

    /**
     * POST /api/messaging/test-configuration
     * Test all configured channels
     * Required: company admin
     */
    router.post(
      "/test-configuration",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      requireCompanyAdmin,
      controller.testConfiguration
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/messaging";
  }
}

module.exports = MessagingConfigApi;
