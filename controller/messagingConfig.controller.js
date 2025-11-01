"use strict";

/**
 * Messaging Configuration Controller
 *
 * Handles API requests for configuring SMS, WhatsApp, and Email
 * All business logic delegated to service layer
 */

const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const twilioProvisioning = require("../services/twilioProvisioning");
const whatsappTemplateService = require("../services/whatsappTemplateService");
const emailProvisioning = require("../services/emailProvisioning");
const {
  smsProvisionSchema,
  phoneNumberSearchSchema,
  phoneNumberPurchaseSchema,
  whatsappProvisionSchema,
  whatsappTemplateSchema,
  emailConfigSchema,
  testMessageSchema,
} = require("../validation/messagingConfigValidation");

// ==================== SMS ENDPOINTS ====================

/**
 * POST /api/messaging/sms/provision
 * Create Twilio subaccount for company
 */
exports.provisionSmsSubaccount = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { error, value } = smsProvisionSchema.validate(req.body || {});

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    const result = await twilioProvisioning.createSubaccount(
      companyId,
      value?.friendlyName
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: result.alreadyExists
        ? "Subaccount already exists"
        : "Subaccount created successfully",
    });
  } catch (error) {
    console.error("Error in provisionSmsSubaccount:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/sms/available-numbers
 * Search for available phone numbers
 */
exports.searchPhoneNumbers = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { error, value } = phoneNumberSearchSchema.validate(req.query || {});

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    const result = await twilioProvisioning.searchPhoneNumbers(companyId, {
      areaCode: value?.areaCode,
      country: value?.country,
      limit: value?.limit || 10,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: `Found ${result.count} available numbers`,
    });
  } catch (error) {
    console.error("Error in searchPhoneNumbers:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/sms/purchase
 * Purchase a phone number
 */
exports.purchasePhoneNumber = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { error, value } = phoneNumberPurchaseSchema.validate(req.body || {});

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    const result = await twilioProvisioning.purchasePhoneNumber(
      companyId,
      value?.phoneNumber,
      value?.type
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: `Phone number purchased for ${value.type}`,
    });
  } catch (error) {
    console.error("Error in purchasePhoneNumber:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/sms/messaging-service
 * Create messaging service
 */
exports.createMessagingService = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await twilioProvisioning.createMessagingService(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: result.alreadyExists
        ? "Messaging service already exists"
        : "Messaging service created successfully",
    });
  } catch (error) {
    console.error("Error in createMessagingService:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/sms/test
 * Send test SMS
 */
exports.sendTestSms = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { error, value } = testMessageSchema.validate(req.body || {});

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    const result = await twilioProvisioning.sendTestSms(
      companyId,
      value?.to,
      value?.message
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: "Test SMS sent successfully",
    });
  } catch (error) {
    console.error("Error in sendTestSms:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/sms/webhook-config?phoneNumber=<phoneNumber>
 * Check webhook configuration for a phone number
 */
exports.getWebhookConfig = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { phoneNumber } = req.query;

    if (!phoneNumber) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "phoneNumber query parameter is required",
      });
    }

    const result = await twilioProvisioning.getPhoneNumberWebhookConfig(
      companyId,
      phoneNumber
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: result.webhookConfigured
        ? "Webhook configured correctly"
        : "Webhook NOT configured correctly",
    });
  } catch (error) {
    console.error("Error in getWebhookConfig:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/sms/fix-webhook
 * Update existing Messaging Service with inbound webhook URL
 */
exports.updateMessagingServiceWebhook = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await twilioProvisioning.updateMessagingServiceWebhook(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message,
    });
  } catch (error) {
    console.error("Error in updateMessagingServiceWebhook:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

// ==================== WHATSAPP ENDPOINTS ====================

/**
 * POST /api/messaging/whatsapp/provision
 * Configure WhatsApp for company
 */
exports.provisionWhatsapp = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { error, value } = whatsappProvisionSchema.validate(req.body || {});

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    // If phoneNumber provided, purchase directly
    if (value.phoneNumber) {
      const result = await twilioProvisioning.purchasePhoneNumber(
        companyId,
        value.phoneNumber,
        "whatsapp"
      );

      return res.status(200).json({
        success: true,
        data: result,
        message:
          "WhatsApp number purchased. Pending Meta approval (usually 2-3 days).",
      });
    }

    // Otherwise, need to search first
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message:
        "Please provide phoneNumber or use /sms/available-numbers to search first",
    });
  } catch (error) {
    console.error("Error in provisionWhatsapp:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/whatsapp/templates
 * Create WhatsApp template
 */
exports.createWhatsappTemplate = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { error, value } = whatsappTemplateSchema.validate(req.body || {});

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    const result = await whatsappTemplateService.createTemplate(
      companyId,
      value
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message,
    });
  } catch (error) {
    console.error("Error in createWhatsappTemplate:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/whatsapp/templates
 * List WhatsApp templates
 */
exports.listWhatsappTemplates = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { status, category } = req.query;

    const result = await whatsappTemplateService.listTemplates(companyId, {
      status,
      category,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: `Found ${result.count} templates`,
    });
  } catch (error) {
    console.error("Error in listWhatsappTemplates:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/whatsapp/templates/:templateId
 * Get single WhatsApp template
 */
exports.getWhatsappTemplate = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { templateId } = req.params;

    const result = await whatsappTemplateService.getTemplate(
      companyId,
      templateId
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in getWhatsappTemplate:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * DELETE /api/messaging/whatsapp/templates/:templateId
 * Delete WhatsApp template
 */
exports.deleteWhatsappTemplate = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { templateId } = req.params;

    const result = await whatsappTemplateService.deleteTemplate(
      companyId,
      templateId
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: "Template deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteWhatsappTemplate:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

// ==================== EMAIL ENDPOINTS ====================

/**
 * POST /api/messaging/email/configure
 * Configure email sender
 */
exports.configureEmail = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { error, value } = emailConfigSchema.validate(req.body || {});

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    const result = await emailProvisioning.configureSender(
      companyId,
      value?.fromEmail,
      value?.fromName,
      value?.replyTo,
      value?.inboundSubdomain
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message,
    });
  } catch (error) {
    console.error("Error in configureEmail:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/email/verification-status
 * Check email verification status
 */
exports.getEmailVerificationStatus = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await emailProvisioning.checkVerificationStatus(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message || "Verification status retrieved",
    });
  } catch (error) {
    console.error("Error in getEmailVerificationStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/email/dns-records?domain=example.com
 * Get DNS records for domain authentication
 * Optional query param: domain - get DNS records for specific domain only
 */
exports.getEmailDnsRecords = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { domain } = req.query;

    const result = await emailProvisioning.getDnsRecords(companyId, domain);

    return res.status(200).json({
      success: true,
      data: result,
      message: domain
        ? `DNS records for ${domain}`
        : "DNS records generated",
    });
  } catch (error) {
    console.error("Error in getEmailDnsRecords:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/email/verify-domain
 * Manually verify domain authentication (for "Verify DNS" button)
 */
exports.verifyEmailDomain = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await emailProvisioning.verifyDomainManually(companyId);

    // Return appropriate status code based on verification result
    const statusCode = result.verified ? 200 : 400;

    return res.status(statusCode).json({
      success: result.success,
      data: result,
      message: result.message,
    });
  } catch (error) {
    console.error("Error in verifyEmailDomain:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/email/test
 * Send test email
 */
exports.sendTestEmail = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { to } = req.body || {};

    const result = await emailProvisioning.testEmailConfiguration(
      companyId,
      to
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: "Test email sent successfully",
    });
  } catch (error) {
    console.error("Error in sendTestEmail:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

// ==================== INBOUND EMAIL ENDPOINTS ====================

/**
 * POST /api/messaging/email/register-inbound
 * Register inbound parse webhook with SendGrid
 * Allows company to receive email replies via their custom subdomain
 */
exports.registerInboundParse = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await emailProvisioning.registerInboundParse(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message || "Inbound email configured successfully",
    });
  } catch (error) {
    console.error("Error in registerInboundParse:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/email/verify-inbound-mx
 * Verify MX record for inbound subdomain
 */
exports.verifyInboundMxRecord = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await emailProvisioning.verifyInboundMxRecord(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message || "MX record verification completed",
    });
  } catch (error) {
    console.error("Error in verifyInboundMxRecord:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * GET /api/messaging/email/inbound-status
 * Get inbound email configuration status
 */
exports.getInboundStatus = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await emailProvisioning.getInboundStatus(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message || "Inbound status retrieved successfully",
    });
  } catch (error) {
    console.error("Error in getInboundStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

// ==================== STATUS ENDPOINTS ====================

/**
 * GET /api/messaging/status
 * Get overall configuration status
 */
exports.getMessagingStatus = async (req, res, next) => {
  try {
    const { companyId } = req;
    const { model: mongooseModel } = require("mongoose");
    const Company = mongooseModel("Company");

    const company = await Company.findById(companyId).select(
      "twilioConfig emailConfig"
    );

    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    const status = {
      sms: {
        configured: !!company.twilioConfig?.subAccountSid,
        hasPhoneNumbers:
          (company.twilioConfig?.fromNumbers?.length || 0) > 0,
        hasMessagingService: !!company.twilioConfig?.messagingServiceSid,
        isActive: company.twilioConfig?.active || false,
        healthStatus: company.twilioConfig?.healthCheckStatus || "unknown",
        phoneNumbers: company.twilioConfig?.fromNumbers || [],
      },
      whatsapp: {
        configured:
          (company.twilioConfig?.whatsappSenders?.length || 0) > 0,
        senders: (company.twilioConfig?.whatsappSenders || []).map((s) => ({
          number: s.number,
          status: s.status,
        })),
      },
      email: {
        configured: company.emailConfig?.provider === "sendgrid",
        senders: (company.emailConfig?.sendgrid?.senders || []).map((s) => ({
          email: s.email,
          name: s.name,
          domain: s.domain,
          verified: s.domainVerified || false,
          isDefault: s.isDefault || false
        })),
        totalSenders: (company.emailConfig?.sendgrid?.senders || []).length,
        verifiedSenders: (company.emailConfig?.sendgrid?.senders || []).filter(s => s.domainVerified).length,
        allVerified: (company.emailConfig?.sendgrid?.senders || []).length > 0 &&
                     (company.emailConfig?.sendgrid?.senders || []).every(s => s.domainVerified),
        verificationStatus: company.emailConfig?.verificationStatus || "none",
        domains: [...new Set((company.emailConfig?.sendgrid?.senders || []).map(s => s.domain))]
      },
      overall: {
        hasAnyChannel:
          (company.twilioConfig?.active || false) ||
          ((company.emailConfig?.sendgrid?.senders || []).some(s => s.domainVerified)),
      },
    };

    return res.status(200).json({
      success: true,
      data: { status },
      message: "Status retrieved successfully",
    });
  } catch (error) {
    console.error("Error in getMessagingStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * POST /api/messaging/test-configuration
 * Test all configured channels
 */
exports.testConfiguration = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await twilioProvisioning.testConfiguration(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: result.success
        ? "Configuration test passed"
        : "Configuration test failed",
    });
  } catch (error) {
    console.error("Error in testConfiguration:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};
