"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");

// Global search validation schema
const globalSearchSchema = Joi.object({
  // Search query (optional - if empty, returns recent items)
  q: Joi.string()
    .trim()
    .allow("")
    .optional()
    .max(200)
    .messages({
      "string.max": "Search query cannot exceed 200 characters"
    }),

  // Entity types to search (comma-separated or "all")
  types: Joi.string()
    .trim()
    .optional()
    .default("all")
    .custom((value, helpers) => {
      if (value === "all") {
        return value;
      }

      const validTypes = ["tasks", "members", "chats", "files", "folders", "documents", "templates"];
      const requestedTypes = value.split(",").map(t => t.trim().toLowerCase());

      const invalidTypes = requestedTypes.filter(type => !validTypes.includes(type));

      if (invalidTypes.length > 0) {
        return helpers.error("any.invalid", { invalidTypes: invalidTypes.join(", ") });
      }

      return requestedTypes.join(",");
    })
    .messages({
      "any.invalid": "Invalid entity types: {{#invalidTypes}}. Valid types are: tasks, members, chats, files, folders, documents, templates"
    }),

  // Quick filters
  assignedTo: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Assigned to must be a valid user ID"
    }),

  createdBy: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Created by must be a valid user ID"
    }),

  // statusKey is per-project/company (system defaults + custom statuses,
  // e.g. "status_1770324786279") — see GET /api/search/statuses for the
  // full set of valid keys for the caller's company. Not a fixed enum.
  status: Joi.string()
    .trim()
    .max(100)
    .optional()
    .messages({
      "string.max": "Status cannot exceed 100 characters"
    }),

  startDate: Joi.date()
    .iso()
    .optional()
    .messages({
      "date.format": "Start date must be a valid ISO date"
    }),

  endDate: Joi.date()
    .iso()
    .min(Joi.ref("startDate"))
    .optional()
    .messages({
      "date.format": "End date must be a valid ISO date",
      "date.min": "End date must be after start date"
    }),

  designation: Joi.string()
    .trim()
    .max(100)
    .optional()
    .messages({
      "string.max": "Designation cannot exceed 100 characters"
    }),

  // Sort options
  sortBy: Joi.string()
    .trim()
    .valid("latest", "name", "relevance")
    .optional()
    .default("latest")
    .messages({
      "any.only": "Sort by must be one of: latest, name, relevance"
    }),

  // Pagination
  page: Joi.number()
    .integer()
    .min(1)
    .optional()
    .default(1)
    .messages({
      "number.min": "Page must be at least 1",
      "number.base": "Page must be a number"
    }),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .messages({
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
      "number.base": "Limit must be a number"
    })
});

// Validation middleware
const validateGlobalSearch = (req, res, next) => {
  const { error, value } = globalSearchSchema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      message: "Validation error",
      errors: error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message
      }))
    });
  }

  // Store validated query params
  req.validatedQuery = value;
  next();
};

module.exports = {
  validateGlobalSearch,
  globalSearchSchema
};
