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
      value?.replyTo
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
 * GET /api/messaging/email/dns-records
 * Get DNS records for inbound email
 */
exports.getEmailDnsRecords = async (req, res, next) => {
  try {
    const { companyId } = req;

    const result = await emailProvisioning.getDnsRecords(companyId);

    return res.status(200).json({
      success: true,
      data: result,
      message: "DNS records generated",
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
        verified: company.emailConfig?.sendgrid?.domainVerified || false,
        verificationStatus: company.emailConfig?.verificationStatus || "none",
        fromEmail: company.twilioConfig?.sendgrid?.fromEmail || null,
      },
      overall: {
        hasAnyChannel:
          (company.twilioConfig?.active || false) ||
          (company.emailConfig?.sendgrid?.domainVerified || false),
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
