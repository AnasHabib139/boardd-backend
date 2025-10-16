"use strict";

const Joi = require("joi");
const { PROJECT_COLUMN_TYPES } = require("../utils/constants");

// Params validation for tabId
const createProjectStatusColumnParamsValidation = Joi.object({
  tabId: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      "string.hex": "Tab ID must be a valid MongoDB ObjectId",
      "string.length": "Tab ID must be 24 characters",
      "any.required": "Tab ID is required",
    }),
});

// Create project status column validation
const createProjectStatusColumnValidation = Joi.object({
  columnName: Joi.string()
    .trim()
    .min(1)
    .max(50)
    .required()
    .messages({
      "string.empty": "Column name is required",
      "string.min": "Column name must be at least 1 character",
      "string.max": "Column name cannot exceed 50 characters",
    }),

  columnType: Joi.string()
    .valid(...Object.values(PROJECT_COLUMN_TYPES))
    .required()
    .messages({
      "any.only": `Column type must be one of: ${Object.values(PROJECT_COLUMN_TYPES).join(", ")}`,
      "any.required": "Column type is required",
    }),

  dropdownOptions: Joi.array()
    .items(Joi.string().trim().min(1).max(30))
    .min(1)
    .max(10)
    .when("columnType", {
      is: PROJECT_COLUMN_TYPES.DROPDOWN,
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      "array.min": "Dropdown must have at least 1 option",
      "array.max": "Dropdown can have maximum 10 options",
      "string.min": "Each option must be at least 1 character",
      "string.max": "Each option cannot exceed 30 characters",
    }),

  isRequired: Joi.boolean()
    .optional()
    .default(false),
});

// Params validation for tabId and columnId
const deleteProjectStatusColumnParamsValidation = Joi.object({
  tabId: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      "string.hex": "Tab ID must be a valid MongoDB ObjectId",
      "string.length": "Tab ID must be 24 characters",
      "any.required": "Tab ID is required",
    }),
  columnId: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      "string.hex": "Column ID must be a valid MongoDB ObjectId",
      "string.length": "Column ID must be 24 characters",
      "any.required": "Column ID is required",
    }),
});

// Update project status column validation
const updateProjectStatusColumnParamsValidation = Joi.object({
  tabId: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      "string.hex": "Tab ID must be a valid MongoDB ObjectId",
      "string.length": "Tab ID must be 24 characters",
      "any.required": "Tab ID is required",
    }),
  columnId: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({
      "string.hex": "Column ID must be a valid MongoDB ObjectId",
      "string.length": "Column ID must be 24 characters",
      "any.required": "Column ID is required",
    }),
});

const updateProjectStatusColumnBodyValidation = Joi.object({
  columnName: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .required()
    .messages({
      "string.empty": "Column name is required",
      "string.min": "Column name must be at least 1 character",
      "string.max": "Column name cannot exceed 100 characters",
      "any.required": "Column name is required",
    }),
});

// Validation middleware function
const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate =
      source === "params"
        ? req.params
        : source === "query"
        ? req.query
        : req.body;

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    // Add validated data to request
    req.validatedBody = value;
    next();
  };
};

module.exports = {
  validateCreateProjectStatusColumn: [
    validateRequest(createProjectStatusColumnParamsValidation, "params"),
    validateRequest(createProjectStatusColumnValidation, "body"),
  ],

  validateDeleteProjectStatusColumn: validateRequest(deleteProjectStatusColumnParamsValidation, "params"),

  validateUpdateProjectStatusColumn: [
    validateRequest(updateProjectStatusColumnParamsValidation, "params"),
    validateRequest(updateProjectStatusColumnBodyValidation, "body"),
  ],

  // Export schemas for testing or custom usage
  schemas: {
    createProjectStatusColumnValidation,
    createProjectStatusColumnParamsValidation,
    deleteProjectStatusColumnParamsValidation,
    updateProjectStatusColumnParamsValidation,
    updateProjectStatusColumnBodyValidation,
  },
};