const Joi = require("joi");

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
      req.query = value;
    } else if (source === "params") {
      req.params = value;
    } else {
      req.body = value;
    }

    next();
  };
};

// Inbox query validation
const inboxQueryValidation = Joi.object({
  filter: Joi.string()
    .valid('important', 'outbox', 'cleared')
    .optional()
    .default('important')
    .messages({
      "any.only": "Filter must be one of: important, outbox, cleared",
    }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = {
  validateInboxQuery: validateRequest(inboxQueryValidation, "query"),

  // Export schemas for testing or custom usage
  schemas: {
    inboxQueryValidation,
  },
};