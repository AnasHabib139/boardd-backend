const Joi = require("joi");
const { helpers } = require("./authValidation");

// Create task comment validation schema
const createTaskCommentValidation = Joi.object({
  message: Joi.string().trim().max(2000).optional().allow("").messages({
    "string.max": "Comment message cannot exceed 2000 characters",
  }),

  attachments: Joi.array()
    .items(Joi.string().uri())
    .optional()
    .default([])
    .max(10)
    .messages({
      "array.base": "Attachments must be an array of valid URLs",
      "string.uri": "Each attachment must be a valid URL",
      "array.max": "Cannot attach more than 10 files",
    }),

  links: Joi.array()
    .items(Joi.string().uri())
    .optional()
    .default([])
    .max(5)
    .messages({
      "array.base": "Links must be an array of valid URLs",
      "string.uri": "Each link must be a valid URL",
      "array.max": "Cannot add more than 5 links",
    }),
}).custom((value, helpers) => {
  // Ensure at least one field is provided
  const hasMessage = value.message && value.message.trim().length > 0;
  const hasAttachments = value.attachments && value.attachments.length > 0;
  const hasLinks = value.links && value.links.length > 0;

  if (!hasMessage && !hasAttachments && !hasLinks) {
    return helpers.error("custom.atLeastOne", {
      message: "At least one of message, attachments, or links is required"
    });
  }
  return value;
}).messages({
  "custom.atLeastOne": "At least one of message, attachments, or links is required"
});

// Task ID parameter validation
const taskIdParamValidation = Joi.object({
  taskId: helpers.objectIdValidation.required().messages({
    "any.required": "Task ID is required",
    "string.pattern.name": "Task ID must be a valid ObjectId",
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
      req.query = value;
    } else if (source === "params") {
      req.params = value;
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = {
  validateCreateTaskComment: validateRequest(createTaskCommentValidation),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),

  // Export schemas for testing or custom usage
  schemas: {
    createTaskCommentValidation,
    taskIdParamValidation,
  },
};
