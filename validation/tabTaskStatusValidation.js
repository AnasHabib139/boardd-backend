"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");

// Create status validation
const createStatusSchema = Joi.object({
  statusName: Joi.string().trim().min(1).max(50).required().messages({
    "string.empty": "Status name is required",
    "string.min": "Status name must be at least 1 character",
    "string.max": "Status name cannot exceed 50 characters",
    "any.required": "Status name is required",
  }),
  color: Joi.string()
    .pattern(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .messages({
      "string.pattern.base": "Color must be a valid hex color (e.g., #FF5733)",
    }),
}).unknown(false);

// Update status validation
const updateStatusSchema = Joi.object({
  statusName: Joi.string().trim().min(1).max(50).optional().messages({
    "string.min": "Status name must be at least 1 character",
    "string.max": "Status name cannot exceed 50 characters",
  }),
  color: Joi.string()
    .pattern(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .messages({
      "string.pattern.base": "Color must be a valid hex color (e.g., #FF5733)",
    }),
  order: Joi.number().integer().min(0).optional().messages({
    "number.base": "Order must be a number",
    "number.integer": "Order must be an integer",
    "number.min": "Order must be at least 0",
  }),
})
  .min(1)
  .unknown(false)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Reorder statuses validation
const reorderStatusesSchema = Joi.object({
  statusOrders: Joi.array()
    .items(
      Joi.object({
        statusId: Joi.string()
          .pattern(/^[0-9a-fA-F]{24}$/)
          .required()
          .messages({
            "string.pattern.base": "Invalid status ID format",
            "any.required": "Status ID is required",
          }),
        order: Joi.number().integer().min(0).required().messages({
          "number.base": "Order must be a number",
          "number.integer": "Order must be an integer",
          "number.min": "Order must be at least 0",
          "any.required": "Order is required",
        }),
      })
    )
    .min(1)
    .required()
    .messages({
      "array.min": "At least one status order must be provided",
      "any.required": "Status orders array is required",
    }),
}).unknown(false);

// Validation middleware factory
const validateRequest = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body);

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      message: "Validation error",
      errors: error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  Object.assign(req.body, value);
  next();
};

// Project ID validation
const validateProjectId = (req, res, next) => {
  const { projectId } = req.params;

  if (!projectId || !/^[0-9a-fA-F]{24}$/.test(projectId)) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      message: "Invalid project ID format",
    });
  }

  next();
};

// Status ID validation
const validateStatusId = (req, res, next) => {
  const { statusId } = req.params;

  if (!statusId || !/^[0-9a-fA-F]{24}$/.test(statusId)) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      message: "Invalid status ID format",
    });
  }

  next();
};

module.exports = {
  validateCreateStatus: validateRequest(createStatusSchema),
  validateUpdateStatus: validateRequest(updateStatusSchema),
  validateReorderStatuses: validateRequest(reorderStatusesSchema),
  validateProjectId,
  validateStatusId,
};
