"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../../utils/constants");
const { BUSINESS_TYPES } = require("../models/PaymentsStripeAccount");
const config = require("../config");

/**
 * Validate tax ID format based on country
 */
function validateTaxId(value, helpers) {
  // Get country from root object (ancestors[1] is root, ancestors[0] is businessInfo)
  const rootObj = helpers.state.ancestors[1];
  const country = rootObj?.country;

  // If no country in request (e.g., during updates), skip validation - Stripe will validate
  if (!country) {
    console.log("Tax ID provided without country in request, skipping client-side validation");
    return value;
  }

  const taxIdFormat = config.taxIdFormats[country];

  if (!taxIdFormat) {
    // If country not in our config, skip validation (Stripe will validate)
    console.log(`Tax ID validation not configured for country: ${country}, skipping client-side validation`);
    return value;
  }

  if (!taxIdFormat.format.test(value)) {
    return helpers.error("any.invalid", {
      message: `Invalid ${taxIdFormat.name} format. Expected format: ${taxIdFormat.example}`,
    });
  }

  return value;
}

/**
 * Address schema (reusable)
 */
const addressSchema = Joi.object({
  line1: Joi.string().trim().min(1).max(200).required().messages({
    "string.empty": "Address line 1 is required",
    "any.required": "Address line 1 is required",
  }),
  line2: Joi.string().trim().max(200).optional().allow(""),
  city: Joi.string().trim().min(1).max(100).required().messages({
    "string.empty": "City is required",
    "any.required": "City is required",
  }),
  state: Joi.string().trim().min(1).max(100).required().messages({
    "string.empty": "State/Province is required",
    "any.required": "State/Province is required",
  }),
  postalCode: Joi.string().trim().min(1).max(20).required().messages({
    "string.empty": "Postal code is required",
    "any.required": "Postal code is required",
  }),
  country: Joi.string().trim().length(2).uppercase().required().messages({
    "string.length": "Country must be a 2-letter ISO code",
    "any.required": "Country is required",
  }),
});

/**
 * Validation middleware for creating Stripe Connect account
 */
exports.validateCreateAccount = async (req, res, next) => {
  try {
    const schema = Joi.object({
      // REQUIRED: Minimal fields to create account (Stripe format)
      country: Joi.string()
        .trim()
        .length(2)
        .uppercase()
        .required()
        .messages({
          "string.length": "Country must be a 2-letter ISO code (e.g., US, GB, CA)",
          "any.required": "Country is required",
        }),

      business_type: Joi.string()
        .valid(...Object.values(BUSINESS_TYPES))
        .required()
        .messages({
          "any.required": "Business type is required",
          "any.only": `Business type must be one of: ${Object.values(BUSINESS_TYPES).join(", ")}`,
        }),

      email: Joi.string()
        .trim()
        .email()
        .required()
        .messages({
          "string.email": "Please provide a valid email address",
          "any.required": "Email is required",
        }),

      // OPTIONAL: Stripe format objects - accept any fields (Stripe validates)
      company: Joi.object().unknown(true).optional(),

      business_profile: Joi.object().unknown(true).optional(),

      tos_acceptance: Joi.object().unknown(true).optional(),

      settings: Joi.object().unknown(true).optional(),

      individual: Joi.object().unknown(true).optional(),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false, // Allow Stripe country-specific fields through
    });

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedBody = value;
    next();
  } catch (error) {
    console.error("Validation error in validateCreateAccount:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for updating Stripe Connect account
 */
exports.validateUpdateAccount = async (req, res, next) => {
  try {
    const schema = Joi.object({
      // Stripe company object - accept any fields (Stripe validates)
      company: Joi.object().unknown(true).optional(),

      // Stripe business_profile object - accept any fields (Stripe validates)
      business_profile: Joi.object().unknown(true).optional(),

      // Stripe tos_acceptance object - accept any fields (Stripe validates)
      tos_acceptance: Joi.object().unknown(true).optional(),

      // Stripe settings object - accept any fields (Stripe validates)
      settings: Joi.object().unknown(true).optional(),

      // Stripe individual object (for sole proprietors) - accept any fields
      individual: Joi.object().unknown(true).optional(),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false, // Allow Stripe country-specific fields through
    });

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedBody = value;
    next();
  } catch (error) {
    console.error("Validation error in validateUpdateAccount:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for adding person (representative/owner)
 * Accepts Stripe format (snake_case)
 */
exports.validateAddPerson = async (req, res, next) => {
  try {
    // Accept any fields Stripe supports - Stripe will validate
    const schema = Joi.object().unknown(true);

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false, // Allow Stripe country-specific fields through
    });

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedBody = value;
    next();
  } catch (error) {
    console.error("Validation error in validateAddPerson:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for updating person (representative/owner)
 * Accepts Stripe format (snake_case)
 */
exports.validateUpdatePerson = async (req, res, next) => {
  try {
    // Accept any fields Stripe supports - Stripe will validate
    const schema = Joi.object().unknown(true);

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false, // Allow Stripe country-specific fields through
    });

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedBody = value;
    next();
  } catch (error) {
    console.error("Validation error in validateUpdatePerson:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for adding external bank account
 */
exports.validateAddExternalAccount = async (req, res, next) => {
  try {
    const schema = Joi.object({
      country: Joi.string().trim().length(2).uppercase().required(),

      currency: Joi.string().trim().length(3).lowercase().required(),

      accountHolderName: Joi.string().trim().min(1).max(200).required(),

      accountHolderType: Joi.string()
        .valid("individual", "company")
        .required(),

      routingNumber: Joi.string().trim().required().messages({
        "string.empty": "Routing number is required",
        "any.required": "Routing number is required",
      }),

      accountNumber: Joi.string().trim().required().messages({
        "string.empty": "Account number is required",
        "any.required": "Account number is required",
      }),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false, // Allow Stripe country-specific fields through
    });

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedBody = value;
    next();
  } catch (error) {
    console.error("Validation error in validateAddExternalAccount:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for getting account status
 */
exports.validateGetAccountStatus = async (req, res, next) => {
  try {
    const schema = Joi.object({
      companyId: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "Invalid company ID format",
          "any.required": "Company ID is required",
        }),
    });

    const { error, value } = schema.validate(req.params);

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedParams = value;
    next();
  } catch (error) {
    console.error("Validation error in validateGetAccountStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};
