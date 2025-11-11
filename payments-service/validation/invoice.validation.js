"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../../utils/constants");

/**
 * Validate line item structure
 */
const lineItemSchema = Joi.object({
  description: Joi.string().trim().min(1).max(500).required().messages({
    "string.empty": "Line item description is required",
    "any.required": "Line item description is required",
    "string.max": "Line item description cannot exceed 500 characters"
  }),
  quantity: Joi.number().integer().min(1).max(999999).required().messages({
    "number.base": "Quantity must be a number",
    "number.min": "Quantity must be at least 1",
    "any.required": "Quantity is required"
  }),
  unitAmount: Joi.number().integer().min(0).required().messages({
    "number.base": "Unit amount must be a number",
    "number.min": "Unit amount cannot be negative",
    "any.required": "Unit amount is required"
  }),
  currency: Joi.string().length(3).optional().default('usd')
});

/**
 * Validate customer address structure (required for automatic tax calculation)
 */
const customerAddressSchema = Joi.object({
  line1: Joi.string().trim().max(200).optional().messages({
    "string.max": "Address line 1 cannot exceed 200 characters"
  }),
  line2: Joi.string().trim().max(200).optional().allow("").messages({
    "string.max": "Address line 2 cannot exceed 200 characters"
  }),
  city: Joi.string().trim().max(100).optional().messages({
    "string.max": "City cannot exceed 100 characters"
  }),
  state: Joi.string().trim().max(100).optional().messages({
    "string.max": "State cannot exceed 100 characters"
  }),
  postal_code: Joi.string().trim().max(20).required().messages({
    "string.empty": "Postal code is required for tax calculation",
    "any.required": "Postal code is required for tax calculation",
    "string.max": "Postal code cannot exceed 20 characters"
  }),
  country: Joi.string().length(2).uppercase().required().messages({
    "string.empty": "Country is required for tax calculation",
    "any.required": "Country is required for tax calculation",
    "string.length": "Country must be a 2-letter ISO code (e.g., 'US', 'GB')"
  })
});

/**
 * Validate billTo structure (billing contact who receives invoice)
 */
const billToSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required().messages({
    "string.empty": "Billing contact name is required",
    "any.required": "Billing contact name is required",
    "string.max": "Billing contact name cannot exceed 200 characters"
  }),
  email: Joi.string().trim().email().required().messages({
    "string.empty": "Billing contact email is required",
    "any.required": "Billing contact email is required",
    "string.email": "Billing contact email must be a valid email address"
  }),
  phone: Joi.string().trim().max(20).optional().allow("").messages({
    "string.max": "Billing contact phone cannot exceed 20 characters"
  })
});

/**
 * Validate platform fee structure
 */
const platformFeeSchema = Joi.object({
  type: Joi.string().valid('percentage', 'fixed').required().messages({
    "any.only": "Fee type must be 'percentage' or 'fixed'",
    "any.required": "Fee type is required"
  }),
  value: Joi.number().min(0).required().messages({
    "number.base": "Fee value must be a number",
    "number.min": "Fee value cannot be negative",
    "any.required": "Fee value is required"
  })
}).messages({
  "object.base": "Platform fee must be an object with type and value"
});

/**
 * Validate create invoice request
 */
exports.validateCreateInvoice = (req, res, next) => {
  const schema = Joi.object({
    collectionMethod: Joi.string()
      .valid('charge_automatically', 'send_invoice')
      .default('send_invoice')
      .messages({
        "any.only": "Collection method must be 'charge_automatically' or 'send_invoice'"
      }),

    dueDate: Joi.date().iso().greater('now').optional().messages({
      "date.base": "Due date must be a valid date",
      "date.greater": "Due date must be in the future"
    }),

    daysUntilDue: Joi.number().integer().min(0).max(365).optional().messages({
      "number.base": "Days until due must be a number",
      "number.min": "Days until due cannot be negative",
      "number.max": "Days until due cannot exceed 365 days"
    }),

    description: Joi.string().trim().max(1000).optional().allow("").messages({
      "string.max": "Description cannot exceed 1000 characters"
    }),

    footer: Joi.string().trim().max(500).optional().allow("").messages({
      "string.max": "Footer cannot exceed 500 characters"
    }),

    currency: Joi.string().length(3).optional().default('usd').messages({
      "string.length": "Currency must be a 3-letter code (e.g., 'usd', 'eur')"
    }),

    lineItems: Joi.array()
      .items(lineItemSchema)
      .min(1)
      .max(50)
      .required()
      .messages({
        "array.min": "At least one line item is required",
        "array.max": "Cannot exceed 50 line items per invoice",
        "any.required": "Line items are required"
      }),

    autoSend: Joi.boolean().optional().default(false).messages({
      "boolean.base": "autoSend must be true or false"
    }),

    enableAutomaticTax: Joi.boolean().optional().default(true),

    customerAddress: customerAddressSchema.optional().messages({
      "object.base": "Customer address must be a valid address object"
    }),

    billTo: billToSchema.optional().messages({
      "object.base": "Billing contact must be a valid object with name and email"
    }),

    paymentMethods: Joi.array()
      .items(Joi.string().valid('card', 'us_bank_account', 'customer_balance'))
      .min(1)
      .optional()
      .default(['card'])
      .messages({
        "array.min": "At least one payment method is required",
        "any.only": "Payment methods must be 'card', 'us_bank_account', or 'customer_balance'"
      }),

    platformFee: platformFeeSchema.optional().messages({
      "object.base": "Platform fee must be a valid object with type and value"
    })
  })
    .custom((value, helpers) => {
      // Custom validation: dueDate and daysUntilDue are mutually exclusive
      if (value.dueDate && value.daysUntilDue) {
        return helpers.error("object.conflict", {
          message: "Cannot specify both dueDate and daysUntilDue. Choose one."
        });
      }
      // Custom validation: if enableAutomaticTax is true, customerAddress is recommended
      if (value.enableAutomaticTax && !value.customerAddress) {
        console.warn("Warning: Automatic tax enabled but no customer address provided. Tax calculation will fail during finalization.");
      }
      return value;
    });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      status: false,
      message: "Validation error",
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }

  req.body = value;
  next();
};

/**
 * Validate update invoice request
 */
exports.validateUpdateInvoice = (req, res, next) => {
  const schema = Joi.object({
    description: Joi.string().trim().max(1000).optional().allow("").messages({
      "string.max": "Description cannot exceed 1000 characters"
    }),

    footer: Joi.string().trim().max(500).optional().allow("").messages({
      "string.max": "Footer cannot exceed 500 characters"
    }),

    dueDate: Joi.date().iso().greater('now').optional().messages({
      "date.base": "Due date must be a valid date",
      "date.greater": "Due date must be in the future"
    }),

    daysUntilDue: Joi.number().integer().min(0).max(365).optional().messages({
      "number.base": "Days until due must be a number",
      "number.min": "Days until due cannot be negative",
      "number.max": "Days until due cannot exceed 365 days"
    }),

    customerAddress: customerAddressSchema.optional().messages({
      "object.base": "Customer address must be a valid address object"
    }),

    billTo: billToSchema.optional().messages({
      "object.base": "Billing contact must be a valid object with name and email"
    })
  })
    .min(1)
    .messages({
      "object.min": "At least one field must be provided to update"
    });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      status: false,
      message: "Validation error",
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }

  req.body = value;
  next();
};

/**
 * Validate create subscription request
 */
exports.validateCreateSubscription = (req, res, next) => {
  const schema = Joi.object({
    amount: Joi.number().integer().min(50).required().messages({
      "number.base": "Amount must be a number",
      "number.min": "Amount must be at least 50 cents",
      "any.required": "Amount is required"
    }),

    currency: Joi.string().length(3).optional().default('usd').messages({
      "string.length": "Currency must be a 3-letter code (e.g., 'usd', 'eur')"
    }),

    interval: Joi.string()
      .valid('day', 'week', 'month', 'year')
      .required()
      .messages({
        "any.only": "Interval must be 'day', 'week', 'month', or 'year'",
        "any.required": "Billing interval is required"
      }),

    intervalCount: Joi.number().integer().min(1).max(365).optional().default(1).messages({
      "number.base": "Interval count must be a number",
      "number.min": "Interval count must be at least 1",
      "number.max": "Interval count cannot exceed 365"
    }),

    collectionMethod: Joi.string()
      .valid('charge_automatically', 'send_invoice')
      .default('charge_automatically')
      .messages({
        "any.only": "Collection method must be 'charge_automatically' or 'send_invoice'"
      }),

    endDate: Joi.date().iso().greater('now').optional().messages({
      "date.base": "End date must be a valid date",
      "date.greater": "End date must be in the future"
    }),

    endAfterCycles: Joi.number().integer().min(1).max(999).optional().messages({
      "number.base": "End after cycles must be a number",
      "number.min": "End after cycles must be at least 1",
      "number.max": "End after cycles cannot exceed 999"
    }),

    description: Joi.string().trim().max(1000).optional().allow("").messages({
      "string.max": "Description cannot exceed 1000 characters"
    }),

    paymentMethods: Joi.array()
      .items(Joi.string().valid('card', 'us_bank_account', 'customer_balance'))
      .min(1)
      .optional()
      .default(['card'])
      .messages({
        "array.min": "At least one payment method is required",
        "any.only": "Payment methods must be 'card', 'us_bank_account', or 'customer_balance'"
      }),

    platformFee: platformFeeSchema.optional().messages({
      "object.base": "Platform fee must be a valid object with type and value"
    })
  })
    .custom((value, helpers) => {
      // Custom validation: endDate and endAfterCycles are mutually exclusive
      if (value.endDate && value.endAfterCycles) {
        return helpers.error("object.conflict", {
          message: "Cannot specify both endDate and endAfterCycles. Choose one or leave both empty for never-ending subscription."
        });
      }
      return value;
    });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      status: false,
      message: "Validation error",
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }

  req.body = value;
  next();
};

/**
 * Validate update subscription request
 */
exports.validateUpdateSubscription = (req, res, next) => {
  const schema = Joi.object({
    amount: Joi.number().integer().min(50).optional().messages({
      "number.base": "Amount must be a number",
      "number.min": "Amount must be at least 50 cents"
    }),

    description: Joi.string().trim().max(1000).optional().allow("").messages({
      "string.max": "Description cannot exceed 1000 characters"
    }),

    endDate: Joi.date().iso().greater('now').optional().messages({
      "date.base": "End date must be a valid date",
      "date.greater": "End date must be in the future"
    }),

    endAfterCycles: Joi.number().integer().min(1).max(999).optional().messages({
      "number.base": "End after cycles must be a number",
      "number.min": "End after cycles must be at least 1",
      "number.max": "End after cycles cannot exceed 999"
    })
  })
    .min(1)
    .messages({
      "object.min": "At least one field must be provided to update"
    });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      status: false,
      message: "Validation error",
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }

  req.body = value;
  next();
};

/**
 * Validate cancel subscription request
 */
exports.validateCancelSubscription = (req, res, next) => {
  const schema = Joi.object({
    cancelAtPeriodEnd: Joi.boolean().optional().default(false).messages({
      "boolean.base": "cancelAtPeriodEnd must be true or false"
    })
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      status: false,
      message: "Validation error",
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }

  req.body = value;
  next();
};
