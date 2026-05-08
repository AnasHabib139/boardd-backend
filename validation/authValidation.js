const Joi = require("joi");

// Token validation for query parameters
const tokenQueryValidation = Joi.object({
  token: Joi.string().trim().optional().messages({
    "string.empty": "Token cannot be empty",
  }),

  joinToken: Joi.string().trim().optional().messages({
    "string.empty": "Join token cannot be empty",
  }),
}).or("token", "joinToken");

// ObjectId validation helper
const objectIdValidation = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .messages({
    "string.pattern.base": "Invalid ID format",
  });

// Email validation for invite endpoints
const emailValidation = Joi.string().email().lowercase().trim().messages({
  "string.email": "Please provide a valid email address",
});

// Pagination validation
const paginationValidation = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1).messages({
    "number.min": "Page must be at least 1",
    "number.integer": "Page must be an integer",
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
      "number.integer": "Limit must be an integer",
    }),
});

// Validation middleware function
const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate =
      source === "query"
        ? req.query
        : source === "params"
        ? req.params
        : req.body;

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

    // Replace the original data with validated data
    if (source === "query") {
      const q = req.query;
      Object.keys(q).forEach((k) => { if (!(k in value)) delete q[k]; });
      Object.assign(q, value);
    } else if (source === "params") {
      req.params = value;
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = {
  validateTokenQuery: validateRequest(tokenQueryValidation, "query"),
  validatePagination: validateRequest(paginationValidation, "query"),

  // Export validation helpers for reuse
  helpers: {
    objectIdValidation,
    emailValidation,
    paginationValidation,
  },

  // Export schemas for testing or custom usage
  schemas: {
    tokenQueryValidation,
    paginationValidation,
  },
};
