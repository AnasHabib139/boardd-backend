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
  }),

  // Notification preferences (for future use)
  notifications: Joi.object({
    email: Joi.boolean().optional().default(true).messages({
      "boolean.base": "Email notification must be a boolean"
    }),
    sms: Joi.boolean().optional().default(false).messages({
      "boolean.base": "SMS notification must be a boolean"
    }),
    push: Joi.boolean().optional().default(false).messages({
      "boolean.base": "Push notification must be a boolean"
    })
  }).optional()
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
    }),

  // Custom card name/label
  customName: Joi.string()
    .max(100)
    .optional()
    .messages({
      "string.max": "Custom card name cannot exceed 100 characters"
    }),

  // Spending limit (single card-wide limit)
  spendingLimit: Joi.object({
    amount: Joi.number()
      .integer()
      .min(1)
      .required()
      .messages({
        "number.base": "Spending limit amount must be a number",
        "number.integer": "Spending limit amount must be an integer (in cents)",
        "number.min": "Spending limit amount must be at least 1 cent",
        "any.required": "Spending limit amount is required"
      }),
    interval: Joi.string()
      .valid("per_authorization", "daily", "weekly", "monthly", "yearly", "all_time")
      .required()
      .messages({
        "any.only": "Interval must be one of: per_authorization, daily, weekly, monthly, yearly, all_time",
        "any.required": "Spending limit interval is required"
      })
  }).optional(),

  // Merchant controls (mutually exclusive)
  allowedMerchants: Joi.array()
    .items(Joi.string())
    .optional()
    .messages({
      "array.base": "Allowed merchants must be an array of strings"
    }),

  blockedMerchants: Joi.array()
    .items(Joi.string())
    .optional()
    .messages({
      "array.base": "Blocked merchants must be an array of strings"
    }),

  // International spending toggle
  allowInternational: Joi.boolean()
    .optional()
    .default(true)
    .messages({
      "boolean.base": "Allow international must be a boolean"
    }),

  // Country controls (mutually exclusive)
  allowedCountries: Joi.array()
    .items(
      Joi.string()
        .length(2)
        .uppercase()
    )
    .optional()
    .messages({
      "array.base": "Allowed countries must be an array",
      "string.length": "Country codes must be 2-letter ISO codes (e.g., 'US')"
    }),

  blockedCountries: Joi.array()
    .items(
      Joi.string()
        .length(2)
        .uppercase()
    )
    .optional()
    .messages({
      "array.base": "Blocked countries must be an array",
      "string.length": "Country codes must be 2-letter ISO codes (e.g., 'US')"
    }),

  // Department and accounting
  department: Joi.string()
    .max(100)
    .optional()
    .messages({
      "string.max": "Department name cannot exceed 100 characters"
    }),

  costCenter: Joi.string()
    .max(100)
    .optional()
    .messages({
      "string.max": "Cost center code cannot exceed 100 characters"
    }),

  projectId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Project ID must be a valid MongoDB ObjectId"
    }),

  // Validity period
  validFrom: Joi.date()
    .iso()
    .optional()
    .messages({
      "date.base": "Valid from must be a valid date",
      "date.format": "Valid from must be in ISO 8601 format"
    }),

  validUntil: Joi.date()
    .iso()
    .greater(Joi.ref("validFrom"))
    .optional()
    .messages({
      "date.base": "Valid until must be a valid date",
      "date.format": "Valid until must be in ISO 8601 format",
      "date.greater": "Valid until must be after valid from date"
    })
})
  // Custom validation for mutually exclusive fields
  .custom((value, helpers) => {
    // Check allowed vs blocked merchants mutual exclusivity
    if (value.allowedMerchants && value.allowedMerchants.length > 0 &&
        value.blockedMerchants && value.blockedMerchants.length > 0) {
      return helpers.error("object.xor", {
        message: "Cannot specify both allowedMerchants and blockedMerchants - use one or the other"
      });
    }

    // Check allowed vs blocked countries mutual exclusivity
    if (value.allowedCountries && value.allowedCountries.length > 0 &&
        value.blockedCountries && value.blockedCountries.length > 0) {
      return helpers.error("object.xor", {
        message: "Cannot specify both allowedCountries and blockedCountries - use one or the other"
      });
    }

    return value;
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

// ==================== Cancel Card ====================

// No body validation needed - cardId comes from URL params
exports.validateCancelCard = (req, res, next) => {
  const { cardId } = req.params;

  if (!cardId || cardId.trim() === "") {
    return generateResponse(
      { error: "Card ID is required" },
      "Card ID is required",
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }

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

// ==================== Banking: Payout to Bank ====================

const payoutSchema = Joi.object({
  amount: Joi.number()
    .integer()
    .min(100)
    .required()
    .messages({
      "number.base": "Amount must be a number",
      "number.integer": "Amount must be an integer (in cents)",
      "number.min": "Minimum payout is $1.00 (100 cents)",
      "any.required": "Amount is required"
    }),

  description: Joi.string()
    .max(255)
    .optional()
    .messages({
      "string.max": "Description cannot exceed 255 characters"
    }),

  method: Joi.string()
    .valid("standard", "instant")
    .default("standard")
    .messages({
      "any.only": "Method must be either 'standard' or 'instant'"
    })
});

exports.validatePayout = (req, res, next) => {
  const { error } = payoutSchema.validate(req.body, { abortEarly: false });

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

// ==================== Banking: Fund Card Balance ====================

const fundCardSchema = Joi.object({
  amount: Joi.number()
    .integer()
    .min(100)
    .required()
    .messages({
      "number.base": "Amount must be a number",
      "number.integer": "Amount must be an integer (in cents)",
      "number.min": "Minimum transfer is $1.00 (100 cents)",
      "any.required": "Amount is required"
    }),

  description: Joi.string()
    .max(255)
    .optional()
    .messages({
      "string.max": "Description cannot exceed 255 characters"
    })
});

exports.validateFundCard = (req, res, next) => {
  const { error } = fundCardSchema.validate(req.body, { abortEarly: false });

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

// ==================== Banking: Get Balance ====================

// No validation needed - fetches balances using authenticated user's company
exports.validateGetBalance = (req, res, next) => {
  next();
};

// ==================== Banking: Payout Settings ====================

// No validation needed for GET
exports.validateGetPayoutSettings = (req, res, next) => {
  next();
};

const updatePayoutSettingsSchema = Joi.object({
  interval: Joi.string()
    .valid("manual", "daily", "weekly", "monthly")
    .required()
    .messages({
      "any.only": "Interval must be one of: manual, daily, weekly, monthly",
      "any.required": "Interval is required"
    }),

  delay_days: Joi.number()
    .integer()
    .min(1)
    .max(14)
    .optional()
    .messages({
      "number.base": "Delay days must be a number",
      "number.integer": "Delay days must be an integer",
      "number.min": "Delay days must be at least 1",
      "number.max": "Delay days cannot exceed 14"
    }),

  weekly_anchor: Joi.string()
    .valid("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    .optional()
    .messages({
      "any.only": "Weekly anchor must be a valid day of the week"
    })
});

exports.validateUpdatePayoutSettings = (req, res, next) => {
  const { error } = updatePayoutSettingsSchema.validate(req.body, { abortEarly: false });

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

// ==================== Company-Wide Transactions ====================

const getAllTransactionsSchema = Joi.object({
  type: Joi.string()
    .valid("invoice", "payout", "fund_card", "all")
    .optional()
    .messages({
      "any.only": "Type must be one of: invoice, payout, fund_card, all"
    }),

  status: Joi.string()
    .valid("paid", "pending", "failed", "all")
    .optional()
    .messages({
      "any.only": "Status must be one of: paid, pending, failed, all"
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

  page: Joi.number()
    .integer()
    .min(1)
    .optional()
    .messages({
      "number.base": "Page must be a number",
      "number.integer": "Page must be an integer",
      "number.min": "Page must be at least 1"
    }),

  startDate: Joi.date()
    .iso()
    .optional()
    .messages({
      "date.base": "Start date must be a valid date",
      "date.format": "Start date must be in ISO 8601 format"
    }),

  endDate: Joi.date()
    .iso()
    .greater(Joi.ref("startDate"))
    .optional()
    .messages({
      "date.base": "End date must be a valid date",
      "date.format": "End date must be in ISO 8601 format",
      "date.greater": "End date must be after start date"
    }),

  search: Joi.string()
    .trim()
    .max(100)
    .optional()
    .messages({
      "string.base": "Search must be a string",
      "string.max": "Search query cannot exceed 100 characters"
    })
});

exports.validateGetAllTransactions = (req, res, next) => {
  const { error } = getAllTransactionsSchema.validate(req.query, { abortEarly: false });

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

const updateTransactionLabelsSchema = Joi.object({
  labels: Joi.array()
    .items(Joi.string().max(50))
    .required()
    .messages({
      "array.base": "Labels must be an array",
      "any.required": "Labels are required",
      "string.max": "Each label cannot exceed 50 characters"
    }),

  source: Joi.string()
    .valid("invoice", "payout", "fund_card")
    .required()
    .messages({
      "any.only": "Source must be one of: invoice, payout, fund_card",
      "any.required": "Source is required"
    })
});

exports.validateUpdateTransactionLabels = (req, res, next) => {
  const { error } = updateTransactionLabelsSchema.validate(req.body, { abortEarly: false });

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

  // Validate id param
  const { id } = req.params;
  if (!id || id.trim() === "") {
    return generateResponse(
      { error: "Transaction ID is required" },
      "Transaction ID is required",
      res,
      STATUS_CODES.BAD_REQUEST
    );
  }

  next();
};
