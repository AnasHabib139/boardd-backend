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
      // REQUIRED: Minimal fields to create account
      country: Joi.string()
        .trim()
        .length(2)
        .uppercase()
        .required()
        .messages({
          "string.length": "Country must be a 2-letter ISO code (e.g., US, GB, CA)",
          "any.required": "Country is required",
        }),

      businessType: Joi.string()
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

      // OPTIONAL: Progressive onboarding fields
      businessInfo: Joi.object({
        legalName: Joi.string().trim().min(1).max(200).optional().messages({
          "string.empty": "Legal business name cannot be empty if provided",
        }),

        dba: Joi.string().trim().max(200).optional().allow("").messages({
          "string.max": "DBA cannot exceed 200 characters",
        }),

        taxId: Joi.string()
          .trim()
          .optional()
          .custom(validateTaxId)
          .messages({
            "any.invalid": "Invalid tax ID format",
          }),

        industry: Joi.string().trim().min(1).max(100).optional().messages({
          "string.empty": "Industry cannot be empty if provided",
        }),

        description: Joi.string().trim().min(10).max(500).optional().messages({
          "string.min": "Description must be at least 10 characters",
        }),

        url: Joi.string().trim().uri().optional().messages({
          "string.uri": "Please provide a valid business URL",
        }),

        phone: Joi.string()
          .trim()
          .pattern(/^\+?[1-9]\d{1,14}$/)
          .optional()
          .messages({
            "string.pattern.base": "Please provide a valid phone number in E.164 format (e.g., +14155551234)",
          }),

        timezone: Joi.string().trim().optional().allow(""),

        mcc: Joi.string()
          .trim()
          .pattern(/^\d{4}$/)
          .optional()
          .messages({
            "string.pattern.base": "MCC must be a 4-digit code",
          }),

        address: addressSchema.optional(),
      }).optional(),

      publicDetails: Joi.object({
        supportEmail: Joi.string().trim().email().optional().messages({
          "string.email": "Please provide a valid support email address",
        }),

        supportPhone: Joi.string()
          .trim()
          .pattern(/^\+?[1-9]\d{1,14}$/)
          .optional()
          .messages({
            "string.pattern.base": "Please provide a valid support phone number",
          }),

        supportUrl: Joi.string().trim().uri().optional().allow("").messages({
          "string.uri": "Please provide a valid support URL",
        }),

        supportAddress: addressSchema.optional(),

        descriptor: Joi.string().trim().max(22).optional().allow("").messages({
          "string.max": "Statement descriptor cannot exceed 22 characters",
        }),
      }).optional(),

      accountRepresentative: Joi.string()
        .trim()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .optional()
        .messages({
          "string.pattern.base": "Account representative must be a valid user ID",
        }),

      ownership: Joi.string().trim().max(200).optional().allow(""),
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
      businessInfo: Joi.object({
        legalName: Joi.string().trim().min(1).max(200).optional(),
        dba: Joi.string().trim().max(200).optional().allow(""),

        taxId: Joi.string()
          .trim()
          .optional()
          .custom(validateTaxId)
          .messages({
            "any.invalid": "Invalid tax ID format",
          }),

        description: Joi.string().trim().min(10).max(500).optional(),
        url: Joi.string().trim().uri().optional(),
        phone: Joi.string()
          .trim()
          .pattern(/^\+?[1-9]\d{1,14}$/)
          .optional(),
        timezone: Joi.string().trim().optional().allow(""),
        mcc: Joi.string()
          .trim()
          .pattern(/^\d{4}$/)
          .optional(),
        address: addressSchema.optional(),
      }).optional(),

      publicDetails: Joi.object({
        supportEmail: Joi.string().trim().email().optional(),
        supportPhone: Joi.string()
          .trim()
          .pattern(/^\+?[1-9]\d{1,14}$/)
          .optional(),
        supportUrl: Joi.string().trim().uri().optional().allow(""),
        supportAddress: addressSchema.optional(),
        descriptor: Joi.string().trim().max(22).optional().allow(""),
      }).optional(),

      tosAcceptance: Joi.object({
        date: Joi.number().optional(),
        ip: Joi.string().trim().optional(),
      }).optional(),
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
 */
exports.validateAddPerson = async (req, res, next) => {
  try {
    const schema = Joi.object({
      relationship: Joi.object({
        representative: Joi.boolean().required(),
        owner: Joi.boolean().required(),
        title: Joi.string().trim().max(100).when("representative", {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        percentOwnership: Joi.number().min(0).max(100).when("owner", {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
      }).required(),

      firstName: Joi.string().trim().min(1).max(100).required().messages({
        "string.empty": "First name is required",
        "any.required": "First name is required",
      }),

      lastName: Joi.string().trim().min(1).max(100).required().messages({
        "string.empty": "Last name is required",
        "any.required": "Last name is required",
      }),

      email: Joi.string().trim().email().required().messages({
        "string.email": "Please provide a valid email address",
        "any.required": "Email is required",
      }),

      phone: Joi.string()
        .trim()
        .pattern(/^\+?[1-9]\d{1,14}$/)
        .optional()
        .messages({
          "string.pattern.base": "Please provide a valid phone number",
        }),

      dateOfBirth: Joi.object({
        day: Joi.number().min(1).max(31).required(),
        month: Joi.number().min(1).max(12).required(),
        year: Joi.number().min(1900).max(new Date().getFullYear() - 18).required(),
      }).required().messages({
        "any.required": "Date of birth is required",
      }),

      address: addressSchema.required(),

      ssnLast4: Joi.string()
        .trim()
        .pattern(/^\d{4}$/)
        .optional()
        .messages({
          "string.pattern.base": "SSN last 4 must be 4 digits",
        }),

      idNumber: Joi.string().trim().optional(),
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
    console.error("Validation error in validateAddPerson:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for updating person (representative/owner)
 */
exports.validateUpdatePerson = async (req, res, next) => {
  try {
    const schema = Joi.object({
      relationship: Joi.object({
        representative: Joi.boolean().optional(),
        owner: Joi.boolean().optional(),
        title: Joi.string().trim().max(100).optional(),
        percentOwnership: Joi.number().min(0).max(100).optional(),
      }).optional(),

      firstName: Joi.string().trim().min(1).max(100).optional(),

      lastName: Joi.string().trim().min(1).max(100).optional(),

      email: Joi.string().trim().email().optional().messages({
        "string.email": "Please provide a valid email address",
      }),

      phone: Joi.string()
        .trim()
        .pattern(/^\+?[1-9]\d{1,14}$/)
        .optional()
        .messages({
          "string.pattern.base": "Please provide a valid phone number",
        }),

      dateOfBirth: Joi.object({
        day: Joi.number().min(1).max(31).optional(),
        month: Joi.number().min(1).max(12).optional(),
        year: Joi.number().min(1900).max(new Date().getFullYear() - 18).optional(),
      }).optional(),

      address: addressSchema.optional(),

      ssnLast4: Joi.string()
        .trim()
        .pattern(/^\d{4}$/)
        .optional()
        .messages({
          "string.pattern.base": "SSN last 4 must be 4 digits",
        }),

      idNumber: Joi.string().trim().optional(),
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
