"use strict";

const Joi = require("joi");

// Login validation
const superAdminLoginValidation = Joi.object({
  email: Joi.string().email().lowercase().trim().required().messages({
    "string.email": "Please provide a valid email address",
    "string.empty": "Email is required",
  }),

  password: Joi.string().min(8).max(30).required().messages({
    "string.min": "Password must be at least 8 characters long",
    "string.max": "Password cannot exceed 30 characters",
    "string.empty": "Password is required",
  }),
});

// Create super admin validation
const createSuperAdminValidation = Joi.object({
  name: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Name is required",
    "string.min": "Name must be at least 2 characters long",
    "string.max": "Name cannot exceed 50 characters",
  }),

  email: Joi.string().email().lowercase().trim().required().messages({
    "string.email": "Please provide a valid email address",
    "string.empty": "Email is required",
  }),

  password: Joi.string().min(8).max(30).required().messages({
    "string.min": "Password must be at least 8 characters long",
    "string.max": "Password cannot exceed 30 characters",
    "string.empty": "Password is required",
  }),
});

// Validation middleware function
const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate = source === "query" ? req.query : req.body;

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
        value: detail.context.value,
      }));

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
        statusCode: 400,
      });
    }

    if (source === "query") {
      const q = req.query;
      Object.keys(q).forEach((k) => { if (!(k in value)) delete q[k]; });
      Object.assign(q, value);
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = {
  validateSuperAdminLogin: validateRequest(superAdminLoginValidation),
  validateCreateSuperAdmin: validateRequest(createSuperAdminValidation),

  // Export schemas for testing or custom usage
  schemas: {
    superAdminLoginValidation,
    createSuperAdminValidation,
  },
};
