const Joi = require("joi");
const { helpers } = require("./authValidation");

// Create / update task comment validation schema
const createTaskCommentValidation = Joi.object({
  contentDoc: Joi.object().required().messages({
    "object.base": "contentDoc must be a valid TipTap JSON object",
    "any.required": "contentDoc is required",
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

  parentCommentId: helpers.objectIdValidation.optional().allow(null).messages({
    "string.pattern.name": "Parent comment ID must be a valid ObjectId",
  }),
});

// Task ID parameter validation
const taskIdParamValidation = Joi.object({
  taskId: helpers.objectIdValidation.required().messages({
    "any.required": "Task ID is required",
    "string.pattern.name": "Task ID must be a valid ObjectId",
  }),
});

// Delete task comment parameter validation (taskId + commentId)
const deleteTaskCommentParamValidation = Joi.object({
  taskId: helpers.objectIdValidation.required().messages({
    "any.required": "Task ID is required",
    "string.pattern.name": "Task ID must be a valid ObjectId",
  }),
  commentId: helpers.objectIdValidation.required().messages({
    "any.required": "Comment ID is required",
    "string.pattern.name": "Comment ID must be a valid ObjectId",
  }),
});

// Get task comments query validation
const getTaskCommentsQueryValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    "number.base": "Page must be a number",
    "number.min": "Page must be at least 1",
  }),
  limit: Joi.number().integer().min(1).max(100).default(20).messages({
    "number.base": "Limit must be a number",
    "number.min": "Limit must be at least 1",
    "number.max": "Limit cannot exceed 100",
  }),
});

// Toggle reaction body validation
const toggleReactionValidation = Joi.object({
  emoji: Joi.string().trim().min(1).max(32).required().messages({
    "any.required": "Emoji is required",
    "string.empty": "Emoji cannot be empty",
    "string.max": "Emoji cannot exceed 32 characters",
  }),
});

// Get comment replies query validation
const getRepliesQueryValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    "number.base": "Page must be a number",
    "number.min": "Page must be at least 1",
  }),
  limit: Joi.number().integer().min(1).max(100).default(20).messages({
    "number.base": "Limit must be a number",
    "number.min": "Limit must be at least 1",
    "number.max": "Limit cannot exceed 100",
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
  validateCreateTaskComment: validateRequest(createTaskCommentValidation),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),
  validateGetTaskCommentsQuery: validateRequest(getTaskCommentsQueryValidation, "query"),
  validateDeleteTaskCommentParams: validateRequest(deleteTaskCommentParamValidation, "params"),
  validateToggleReaction: validateRequest(toggleReactionValidation),
  validateGetRepliesQuery: validateRequest(getRepliesQueryValidation, "query"),

  // Export schemas for testing or custom usage
  schemas: {
    createTaskCommentValidation,
    taskIdParamValidation,
    getTaskCommentsQueryValidation,
    deleteTaskCommentParamValidation,
    toggleReactionValidation,
    getRepliesQueryValidation,
  },
};
