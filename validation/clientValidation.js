const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");

// Personal details validation schema
const personalDetailsSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Name is required",
    "string.min": "Name must be at least 2 characters long",
    "string.max": "Name cannot exceed 100 characters",
  }),

  email: Joi.string().email().trim().required().messages({
    "string.email": "Please provide a valid email address",
    "string.empty": "Email is required",
  }),

  phone: Joi.object({
    countryCode: Joi.string().trim().required().messages({
      "string.empty": "Country code is required",
    }),
    number: Joi.string()
      .trim()
      .pattern(/^[0-9+\-\s()]+$/)
      .min(7)
      .max(15)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid phone number",
        "string.min": "Phone number must be at least 7 characters",
        "string.max": "Phone number cannot exceed 15 characters",
        "string.empty": "Phone number is required",
      }),
  }).required(),

  address: Joi.object({
    line_1: Joi.string().trim().min(5).max(200).required().messages({
      "string.min": "Address line 1 must be at least 5 characters",
      "string.max": "Address line 1 cannot exceed 200 characters",
      "string.empty": "Address line 1 is required",
    }),
    line_2: Joi.string().trim().min(3).max(200).required().messages({
      "string.min": "Address line 2 must be at least 3 characters",
      "string.max": "Address line 2 cannot exceed 200 characters",
      "string.empty": "Address line 2 is required",
    }),
  }).required(),

  company: Joi.string().trim().max(100).optional().allow("").messages({
    "string.max": "Company name cannot exceed 100 characters",
  }),
});

// Project validation schema
const projectSchema = Joi.object({
  title: Joi.string().trim().min(3).max(200).required().messages({
    "string.min": "Project title must be at least 3 characters",
    "string.max": "Project title cannot exceed 200 characters",
    "string.empty": "Project title is required",
  }),

  description: Joi.string().trim().max(1000).optional().allow("").messages({
    "string.max": "Project description cannot exceed 1000 characters",
  }),
});

// Attachment validation schema (URL or file path)
const attachmentSchema = Joi.string().trim().uri().required().messages({
  "string.uri": "Attachment must be a valid URL or file path",
  "string.empty": "Attachment is required",
});

// Main validation schema for createOrUpdateClient
const createOrUpdateClientSchema = Joi.object({
  tabId: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "Tab ID must be a valid MongoDB ObjectId",
      "string.empty": "Tab ID is required",
    }),

  personalDetails: personalDetailsSchema.optional(),

  attachments: attachmentSchema.optional(),

  projects: projectSchema.optional(),
})
  .or("personalDetails", "attachments", "projects")
  .messages({
    "object.missing":
      "At least one field (personalDetails, attachments, or projects) is required",
  });

// Validation middleware
exports.validateCreateOrUpdateClient = (req, res, next) => {
  const { error } = createOrUpdateClientSchema.validate(req.body, {
    abortEarly: false, // Get all validation errors
    stripUnknown: true, // Remove unknown fields
  });

  if (error) {
    const errorMessages = error.details.map((detail) => ({
      field: detail.path.join("."),
      message: detail.message,
    }));

    return res.status(STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: "Validation failed",
      errors: errorMessages,
    });
  }

  next();
};
