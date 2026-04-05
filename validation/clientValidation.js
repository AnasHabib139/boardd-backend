const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");

// Client details validation schema (all fields optional)
const clientDetailsSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(100).optional().allow("").messages({
    "string.min": "First name must be at least 1 character long",
    "string.max": "First name cannot exceed 100 characters",
  }),

  lastName: Joi.string().trim().min(1).max(100).optional().allow("").messages({
    "string.min": "Last name must be at least 1 character long",
    "string.max": "Last name cannot exceed 100 characters",
  }),

  email: Joi.string().email().trim().optional().allow("").messages({
    "string.email": "Please provide a valid email address",
  }),

  phone: Joi.object({
    countryCode: Joi.string().trim().optional().allow("").messages({
      "string.base": "Country code must be a string",
    }),
    number: Joi.string()
      .trim()
      .pattern(/^[0-9+\-\s()]*$/)
      .max(15)
      .optional()
      .allow("")
      .messages({
        "string.pattern.base": "Please provide a valid phone number",
        "string.max": "Phone number cannot exceed 15 characters",
      }),
  }).optional(),

  address: Joi.object({
    line_1: Joi.string().trim().max(200).optional().allow("").messages({
      "string.max": "Address line 1 cannot exceed 200 characters",
    }),
    line_2: Joi.string().trim().max(200).optional().allow("").messages({
      "string.max": "Address line 2 cannot exceed 200 characters",
    }),
    country: Joi.string().trim().max(100).optional().allow("").messages({
      "string.max": "Country cannot exceed 100 characters",
    }),
    zipCode: Joi.string().trim().max(20).optional().allow("").messages({
      "string.max": "Zip code cannot exceed 20 characters",
    }),
  }).optional(),

  companyName: Joi.string().trim().max(100).optional().allow("").messages({
    "string.max": "Company name cannot exceed 100 characters",
  }),

  attachments: Joi.array()
    .items(
      Joi.string().trim().min(1).max(500).messages({
        "string.min": "Attachment cannot be empty",
        "string.max": "Attachment path cannot exceed 500 characters",
      })
    )
    .max(10)
    .optional()
    .messages({
      "array.max": "Cannot have more than 10 attachments",
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

  attachments: Joi.array()
    .items(
      Joi.string().trim().min(1).max(500).messages({
        "string.min": "Attachment cannot be empty",
        "string.max": "Attachment path cannot exceed 500 characters",
      })
    )
    .max(10)
    .optional()
    .messages({
      "array.max": "Cannot have more than 10 attachments",
    }),
});

// Main validation schema for createOrUpdateClient
const createOrUpdateClientSchema = Joi.object({
  tabId: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .allow(null, "")
    .messages({
      "string.pattern.base": "Tab ID must be a valid MongoDB ObjectId",
    }),

  clientDetails: clientDetailsSchema.optional(),

  projects: projectSchema.optional(),
})
  .or("clientDetails", "projects")
  .messages({
    "object.missing":
      "At least one field (clientDetails or projects) is required",
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

// Update client data validation schema
const updateClientDataSchema = Joi.object({
  type: Joi.string().valid("clientDetails", "projects").required().messages({
    "any.only": "Type must be either 'clientDetails' or 'projects'",
    "any.required": "Type is required",
  }),

  id: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "ID must be a valid MongoDB ObjectId",
      "any.required": "ID is required",
    }),

  data: Joi.when("type", {
    is: "clientDetails",
    then: clientDetailsSchema.required(),
    otherwise: Joi.when("type", {
      is: "projects",
      then: projectSchema.required(),
      otherwise: Joi.forbidden(),
    }),
  }).messages({
    "any.required": "Data is required",
  }),
});

// Delete client data validation schema
const deleteClientDataSchema = Joi.object({
  type: Joi.string()
    .valid("clientDetails", "projects")
    .required()
    .messages({
      "any.only": "Type must be 'clientDetails' or 'projects'",
      "any.required": "Type is required",
    }),

  id: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "ID must be a valid MongoDB ObjectId",
      "any.required": "ID is required",
    }),
});

// Validation middleware for update client data
exports.validateUpdateClientData = (req, res, next) => {
  const { error } = updateClientDataSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
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

// Validation middleware for delete client data
exports.validateDeleteClientData = (req, res, next) => {
  const { error } = deleteClientDataSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
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
