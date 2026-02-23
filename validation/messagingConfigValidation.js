"use strict";

/**
 * Validation Schemas for Messaging Configuration APIs
 * Uses Joi for request validation
 */

const Joi = require("joi");

/**
 * Validate SMS provisioning request
 */
const smsProvisionSchema = Joi.object({
  friendlyName: Joi.string().max(100).optional(),
});

/**
 * Validate phone number search request
 */
const phoneNumberSearchSchema = Joi.object({
  areaCode: Joi.string()
    .pattern(/^\d{3}$/)
    .required()
    .messages({
      "string.pattern.base": "Area code must be exactly 3 digits",
    }),
  country: Joi.string().length(2).uppercase().default("US"),
});

/**
 * Validate phone number purchase request
 */
const phoneNumberPurchaseSchema = Joi.object({
  phoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{6,14}$/)
    .required()
    .messages({
      "string.pattern.base": "Phone number must be in E.164 format (e.g., +15551234567)",
    }),
  type: Joi.string().valid("sms", "whatsapp").default("sms"),
});

/**
 * Validate WhatsApp provisioning request
 */
const whatsappProvisionSchema = Joi.object({
  businessName: Joi.string().min(2).max(100).required(),
  businessCategory: Joi.string().max(50).optional(),
  areaCode: Joi.string().pattern(/^\d{3}$/).optional(),
  phoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{6,14}$/)
    .optional(),
});

/**
 * Validate WhatsApp template creation
 */
const whatsappTemplateSchema = Joi.object({
  name: Joi.string()
    .pattern(/^[a-z0-9_]+$/)
    .min(1)
    .max(50)
    .required()
    .messages({
      "string.pattern.base": "Template name must be lowercase alphanumeric with underscores only",
    }),
  language: Joi.string().length(2).lowercase().default("en"),
  category: Joi.string()
    .valid("MARKETING", "UTILITY", "AUTHENTICATION")
    .required()
    .messages({
      "any.only": "Category must be one of: MARKETING, UTILITY, AUTHENTICATION",
    }),
  components: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid("HEADER", "BODY", "FOOTER", "BUTTONS").required(),
        text: Joi.string().max(1024).when("type", {
          is: "BODY",
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        parameters: Joi.array().items(Joi.string()).optional(),
        buttons: Joi.array()
          .items(
            Joi.object({
              type: Joi.string().valid("quick_reply", "url", "phone_number").required(),
              text: Joi.string().max(25).required(),
              url: Joi.string().uri().when("type", {
                is: "url",
                then: Joi.required(),
                otherwise: Joi.forbidden(),
              }),
              phoneNumber: Joi.string().when("type", {
                is: "phone_number",
                then: Joi.required(),
                otherwise: Joi.forbidden(),
              }),
            })
          )
          .optional(),
      })
    )
    .min(1)
    .required(),
});

/**
 * Validate email configuration request
 */
const emailConfigSchema = Joi.object({
  fromEmail: Joi.string()
    .email()
    .required()
    .messages({
      "string.email": "Must be a valid email address",
    }),
  fromName: Joi.string().min(1).max(100).required(),
  replyTo: Joi.string().email().optional(),
  inboundSubdomain: Joi.string()
    .pattern(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i)
    .optional()
    .messages({
      "string.pattern.base": "Inbound subdomain must be a valid domain (e.g., inbound.company.com)",
    }),
});

/**
 * Validate test message request
 */
const testMessageSchema = Joi.object({
  to: Joi.string().required(),
  message: Joi.string().max(500).default("This is a test message from your Boarddd messaging configuration."),
});

/**
 * Validate WhatsApp sender registration request
 */
const whatsappSenderRegistrationSchema = Joi.object({
  phoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{6,14}$/)
    .required()
    .messages({
      "string.pattern.base": "Phone number must be in E.164 format (e.g., +15551234567)",
    }),
});

/**
 * Validate WhatsApp Tech Provider Embedded Signup initialization
 */
const whatsappTechProviderInitSchema = Joi.object({
  businessName: Joi.string()
    .min(2)
    .max(100)
    .required()
    .messages({
      "string.min": "Business name must be at least 2 characters",
      "string.max": "Business name must not exceed 100 characters",
      "any.required": "Business name is required for Embedded Signup",
    }),
  phoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{6,14}$/)
    .optional()
    .messages({
      "string.pattern.base": "Phone number must be in E.164 format (e.g., +15551234567)",
    }),
});

/**
 * Validate WhatsApp Tech Provider sender registration
 */
const whatsappTechProviderRegisterSchema = Joi.object({
  phoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{6,14}$/)
    .required()
    .messages({
      "string.pattern.base": "Phone number must be in E.164 format (e.g., +15551234567)",
      "any.required": "Phone number is required",
    }),
  displayName: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      "string.min": "Display name must be at least 1 character",
      "string.max": "Display name must not exceed 100 characters",
      "any.required": "Display name is required for WhatsApp sender registration",
    }),
});

module.exports = {
  smsProvisionSchema,
  phoneNumberSearchSchema,
  phoneNumberPurchaseSchema,
  whatsappProvisionSchema,
  whatsappTemplateSchema,
  emailConfigSchema,
  testMessageSchema,
  whatsappSenderRegistrationSchema,
  whatsappTechProviderInitSchema,
  whatsappTechProviderRegisterSchema,
};
