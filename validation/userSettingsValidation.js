"use strict";

const Joi = require("joi");
const bcrypt = require("bcrypt");
const { STATUS_CODES } = require("../utils/constants");

// User settings update validation schema
const updateUserSettingsSchema = Joi.object({
  // Basic profile updates
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .messages({
      "string.min": "Name must be at least 2 characters long",
      "string.max": "Name cannot exceed 100 characters",
      "string.empty": "Name cannot be empty"
    }),

  // Password update
  oldPassword: Joi.string()
    .when('newPassword', {
      is: Joi.exist(),
      then: Joi.required(),
      otherwise: Joi.optional()
    })
    .messages({
      "any.required": "Old password is required when updating password"
    }),

  newPassword: Joi.string()
    .min(6)
    .max(128)
    .optional()
    .pattern(new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)"))
    .messages({
      "string.min": "New password must be at least 6 characters long",
      "string.max": "New password cannot exceed 128 characters", 
      "string.pattern.base": "New password must contain at least one lowercase letter, one uppercase letter, and one number"
    }),

  // Nickname field (optional)
  nickname: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .optional()
    .messages({
      "string.min": "Nickname must be at least 2 characters long",
      "string.max": "Nickname cannot exceed 50 characters",
      "string.empty": "Nickname cannot be empty"
    }),

  // Job title field (optional)
  title: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .messages({
      "string.min": "Title must be at least 2 characters long",
      "string.max": "Title cannot exceed 100 characters",
      "string.empty": "Title cannot be empty"
    }),

  // Professional designation field (optional)
  designation: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .messages({
      "string.min": "Designation must be at least 2 characters long",
      "string.max": "Designation cannot exceed 100 characters",
      "string.empty": "Designation cannot be empty"
    }),

  // User bio/description field (optional)
  description: Joi.string()
    .trim()
    .min(10)
    .max(500)
    .optional()
    .messages({
      "string.min": "Description must be at least 10 characters long",
      "string.max": "Description cannot exceed 500 characters",
      "string.empty": "Description cannot be empty"
    }),

  // Theme settings
  theme: Joi.object({
    color: Joi.string()
      .pattern(/^#([0-9A-F]{3}){1,2}$/i)
      .optional()
      .messages({
        "string.pattern.base": "Theme color must be a valid hex color code (e.g., #6C63FF)"
      })
  }).optional(),

  // Localization settings
  localization: Joi.object({
    language: Joi.string()
      .trim()
      .lowercase()
      .min(2)
      .max(50)
      .optional()
      .messages({
        "string.min": "Language must be at least 2 characters long",
        "string.max": "Language cannot exceed 50 characters"
      }),

    timezone: Joi.string()
      .trim()
      .min(3)
      .max(50)
      .optional()
      .messages({
        "string.min": "Timezone must be at least 3 characters long", 
        "string.max": "Timezone cannot exceed 50 characters"
      }),

    timeFormat: Joi.string()
      .valid("12", "24")
      .optional()
      .messages({
        "any.only": "Time format must be either '12' or '24'"
      }),

    dateFormat: Joi.string()
      .valid("dd/mm/yyyy", "mm/dd/yyyy", "yyyy/mm/dd", "yyyy-mm-dd")
      .optional()
      .messages({
        "any.only": "Date format must be one of: dd/mm/yyyy, mm/dd/yyyy, yyyy/mm/dd, yyyy-mm-dd"
      })
  }).optional(),

  // Notification settings (optional for future use)
  notifications: Joi.object({
    email: Joi.boolean().optional(),
    push: Joi.boolean().optional(),
    desktop: Joi.boolean().optional()
  }).optional(),

  // Privacy settings (optional for future use)
  privacy: Joi.object({
    profileVisibility: Joi.string()
      .valid("public", "company", "private")
      .optional()
      .messages({
        "any.only": "Profile visibility must be one of: public, company, private"
      })
  }).optional()
})
.min(1) // At least one field must be provided
.messages({
  "object.min": "At least one field must be provided for update"
});

// Validation middleware
const validateUpdateUserSettings = (req, res, next) => {
  const { error, value } = updateUserSettingsSchema.validate(req.body);

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      message: "Validation error",
      errors: error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  // No additional validation needed for password since we check in controller

  // Store validated data
  req.validatedBody = value;
  next();
};

module.exports = {
  validateUpdateUserSettings,
  updateUserSettingsSchema
};