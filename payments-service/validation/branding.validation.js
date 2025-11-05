"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../../utils/constants");

/**
 * Validation middleware for branding file upload
 */
exports.validateBrandingFileUpload = async (req, res, next) => {
  try {
    // Validate purpose parameter
    const schema = Joi.object({
      purpose: Joi.string()
        .valid("business_logo", "business_icon")
        .required()
        .messages({
          "any.required": "Purpose is required",
          "any.only": "Purpose must be either 'business_logo' or 'business_icon'",
        }),
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    // Validate file
    if (!req.file) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "File is required",
      });
    }

    // Validate file type
    const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png"];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid file type. Only JPEG and PNG are allowed",
      });
    }

    // Validate file size (512KB = 524288 bytes)
    const maxSize = 512 * 1024;
    if (req.file.size > maxSize) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "File size exceeds maximum limit of 512KB",
      });
    }

    req.validatedBody = value;
    next();
  } catch (error) {
    console.error("Validation error in validateBrandingFileUpload:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for updating branding settings
 */
exports.validateUpdateBranding = async (req, res, next) => {
  try {
    // Hex color regex pattern
    const hexColorPattern = /^#[0-9A-Fa-f]{6}$/;

    const schema = Joi.object({
      icon: Joi.string().trim().allow(null).optional().messages({
        "string.base": "Icon must be a file ID string",
      }),

      logo: Joi.string().trim().allow(null).optional().messages({
        "string.base": "Logo must be a file ID string",
      }),

      primary_color: Joi.string()
        .trim()
        .pattern(hexColorPattern)
        .allow(null)
        .optional()
        .messages({
          "string.pattern.base":
            "Primary color must be a valid hex color code (e.g., #0066cc)",
        }),

      secondary_color: Joi.string()
        .trim()
        .pattern(hexColorPattern)
        .allow(null)
        .optional()
        .messages({
          "string.pattern.base":
            "Secondary color must be a valid hex color code (e.g., #333333)",
        }),
    })
      .min(1)
      .messages({
        "object.min": "At least one branding field is required",
      });

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
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
    console.error("Validation error in validateUpdateBranding:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};
