const Joi = require("joi");
const { helpers } = require("./authValidation");

const objectIdValidation = helpers.objectIdValidation;

// Create task connection validation schema (body)
const createTaskConnectionValidation = Joi.object({
  sourceTaskId: objectIdValidation.required().messages({
    "any.required": "Source task ID is required",
    "string.pattern.base": "Source task ID must be a valid ObjectId",
  }),
  targetTaskId: objectIdValidation.required().messages({
    "any.required": "Target task ID is required",
    "string.pattern.base": "Target task ID must be a valid ObjectId",
  }),
});

// Task ID param validation (params)
const taskIdParamValidation = Joi.object({
  taskId: objectIdValidation.required().messages({
    "any.required": "Task ID is required",
    "string.pattern.base": "Task ID must be a valid ObjectId",
  }),
});

// Connection ID param validation (params)
const connectionIdParamValidation = Joi.object({
  connectionId: objectIdValidation.required().messages({
    "any.required": "Connection ID is required",
    "string.pattern.base": "Connection ID must be a valid ObjectId",
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

    if (source === "params") {
      req.params = value;
    } else if (source === "query") {
      req.query = value;
    } else {
      req.body = value;
    }

    next();
  };
};

// Search tasks query validation
const searchTasksQueryValidation = Joi.object({
  channelId: objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
    "string.pattern.base": "Channel ID must be a valid ObjectId",
  }),
  search: Joi.string().trim().min(1).max(100).optional().messages({
    "string.min": "Search term must be at least 1 character",
    "string.max": "Search term must not exceed 100 characters",
  }),
  excludeTaskId: objectIdValidation.optional().messages({
    "string.pattern.base": "Exclude task ID must be a valid ObjectId",
  }),
  limit: Joi.number().integer().min(1).max(50).default(20).optional().messages({
    "number.min": "Limit must be at least 1",
    "number.max": "Limit must not exceed 50",
  }),
});

module.exports = {
  validateCreateTaskConnection: validateRequest(createTaskConnectionValidation),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),
  validateConnectionIdParam: validateRequest(
    connectionIdParamValidation,
    "params"
  ),
  validateSearchTasksQuery: validateRequest(searchTasksQueryValidation, "query"),

  schemas: {
    createTaskConnectionValidation,
    taskIdParamValidation,
    connectionIdParamValidation,
    searchTasksQueryValidation,
  },
};
