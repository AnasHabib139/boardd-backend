"use strict";

const Joi = require("joi");
const { generateResponse } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");

/**
 * Validation middleware for Issuing endpoints
 */

// ==================== Enable Issuing Capability ====================

// No validation needed - companyId is fetched from authenticated user
exports.validateEnableIssuing = (req, res, next) => {
  // No body or params to validate
  next();
};

// ==================== Complete Issuing Requirements ====================

const completeRequirementsSchema = Joi.object({
  annualRevenue: Joi.object({
    amount: Joi.number()
      .integer()
      .min(0)
      .required()
      .messages({
        "number.base": "Annual revenue amount must be a number",
        "number.min": "Annual revenue amount must be at least 0",
        "any.required": "Annual revenue amount is required"
      }),
    currency: Joi.string()
      .length(3)
      .lowercase()
      .required()
      .messages({
        "string.length": "Currency must be a 3-letter code (e.g., 'usd')",
        "any.required": "Currency is required"
      }),
    fiscalYearEnd: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        "string.pattern.base": "Fiscal year end must be in format YYYY-MM-DD (e.g., '2024-12-31')",
        "any.required": "Fiscal year end is required"
      })
  }).optional(),

  estimatedWorkerCount: Joi.number()
    .integer()
    .min(1)
    .optional()
    .messages({
      "number.base": "Estimated worker count must be a number",
      "number.integer": "Estimated worker count must be an integer",
      "number.min": "Estimated worker count must be at least 1"
    }),

  tosAcceptance: Joi.object({
    date: Joi.number()
      .integer()
      .min(0)
      .required()
      .messages({
        "number.base": "TOS acceptance date must be a Unix timestamp",
        "number.min": "TOS acceptance date must be a valid timestamp",
        "any.required": "TOS acceptance date is required"
      }),
    ip: Joi.string()
      .ip()
      .required()
      .messages({
        "string.ip": "TOS acceptance IP must be a valid IP address",
        "any.required": "TOS acceptance IP is required"
      })
  }).optional()
}).min(1).messages({
  "object.min": "At least one field (annualRevenue, estimatedWorkerCount, or tosAcceptance) must be provided"
});

exports.validateCompleteRequirements = (req, res, next) => {
  const { error } = completeRequirementsSchema.validate(req.body, {
    abortEarly: false
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join("."),
      message: detail.message
    }));

    return generateResponse(
      { errors },
      "Validation error",
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }

  next();
};

// ==================== Create Cardholder ====================

const createCardholderSchema = Joi.object({
  firstName: Joi.string()
    .required()
    .min(1)
    .max(50)
    .messages({
      "string.empty": "First name is required",
      "string.min": "First name cannot be empty",
      "string.max": "First name cannot exceed 50 characters",
      "any.required": "First name is required"
    }),

  lastName: Joi.string()
    .required()
    .min(1)
    .max(50)
    .messages({
      "string.empty": "Last name is required",
      "string.min": "Last name cannot be empty",
      "string.max": "Last name cannot exceed 50 characters",
      "any.required": "Last name is required"
    }),

  email: Joi.string()
    .email()
    .required()
    .messages({
      "string.email": "Invalid email address",
      "any.required": "Email is required"
    }),

  phoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .optional()
    .messages({
      "string.pattern.base": "Phone number must be in E.164 format (e.g., +14155551234)"
    }),

  userIp: Joi.string()
    .ip()
    .optional()
    .messages({
      "string.ip": "User IP must be a valid IP address"
    }),

  billing: Joi.object({
    address: Joi.object({
      line1: Joi.string().required().messages({
        "any.required": "Address line 1 is required"
      }),
      line2: Joi.string().optional().allow("", null),
      city: Joi.string().required().messages({
        "any.required": "City is required"
      }),
      state: Joi.string().optional().allow("", null),
      postal_code: Joi.string().required().messages({
        "any.required": "Postal code is required"
      }),
      country: Joi.string().length(2).uppercase().required().messages({
        "string.length": "Country must be a 2-letter code (e.g., 'US')",
        "any.required": "Country is required"
      })
    }).required()
  }).required().messages({
    "any.required": "Billing address is required"
  })
});

exports.validateCreateCardholder = (req, res, next) => {
  const { error } = createCardholderSchema.validate(req.body, {
    abortEarly: false
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join("."),
      message: detail.message
    }));

    return generateResponse(
      { errors },
      "Validation error",
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }

  next();
};

// ==================== Issue Card ====================

const issueCardSchema = Joi.object({
  currency: Joi.string()
    .length(3)
    .lowercase()
    .optional()
    .default("usd")
    .messages({
      "string.length": "Currency must be a 3-letter code (e.g., 'usd')"
    })
});

exports.validateIssueCard = (req, res, next) => {
  const { error } = issueCardSchema.validate(req.body, {
    abortEarly: false
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join("."),
      message: detail.message
    }));

    return generateResponse(
      { errors },
      "Validation error",
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }

  next();
};

// ==================== Create Financial Account ====================

// No body validation needed - currency defaults to USD
exports.validateCreateFinancialAccount = (req, res, next) => {
  next();
};

// ==================== Toggle Card Freeze ====================

// No body validation needed - toggle logic handled by service
exports.validateToggleCardFreeze = (req, res, next) => {
  next();
};

// ==================== List Transactions ====================

const listTransactionsSchema = Joi.object({
  type: Joi.string()
    .valid("purchase", "refunds", "deposit", "send")
    .optional()
    .messages({
      "any.only": "Type must be one of: purchase, refunds, deposit, send"
    }),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .optional()
    .messages({
      "number.base": "Limit must be a number",
      "number.integer": "Limit must be an integer",
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100"
    }),

  starting_after: Joi.string()
    .optional()
    .messages({
      "string.base": "starting_after must be a string"
    })
});

exports.validateListTransactions = (req, res, next) => {
  const { error } = listTransactionsSchema.validate(req.query, { abortEarly: false });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join("."),
      message: detail.message
    }));

    return generateResponse(
      { errors },
      "Validation error",
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }

  next();
};
