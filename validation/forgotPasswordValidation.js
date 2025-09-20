"use strict";

const Joi = require("joi");

/**
 * Validation schema for forgot password request
 * Handles three different scenarios:
 * 1. Send code: { email }
 * 2. Verify code: { email, code }
 * 3. Reset password: { email, code, newPassword }
 */
const forgotPasswordSchema = Joi.object({
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .lowercase()
    .trim()
    .required()
    .messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),

  code: Joi.string()
    .pattern(/^\d{6}$/)
    .optional()
    .messages({
      "string.pattern.base": "Code must be exactly 6 digits",
    }),

  newPassword: Joi.string()
    .min(8)
    .optional()
    .messages({
      "string.min": "Password must be at least 8 characters long",
    }),
})
  .custom((value, helpers) => {
    const { email, code, newPassword } = value;

    // Scenario 1: Send code (email only)
    if (email && !code && !newPassword) {
      return value; // Valid
    }

    // Scenario 2: Verify code (email + code)
    if (email && code && !newPassword) {
      return value; // Valid
    }

    // Scenario 3: Reset password (email + code + newPassword)
    if (email && code && newPassword) {
      return value; // Valid
    }

    // Invalid combinations
    if (newPassword && !code) {
      return helpers.error("custom.invalidCombination", {
        message: "Code is required when providing a new password",
      });
    }

    if (code && !email) {
      return helpers.error("custom.invalidCombination", {
        message: "Email is required when providing a code",
      });
    }

    return helpers.error("custom.invalidCombination", {
      message: "Invalid parameter combination",
    });
  })
  .messages({
    "custom.invalidCombination": "{{#message}}",
  });

/**
 * Middleware to validate forgot password request
 */
exports.validateForgotPassword = (req, res, next) => {
  const { error } = forgotPasswordSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message);
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errorMessages,
    });
  }

  next();
};