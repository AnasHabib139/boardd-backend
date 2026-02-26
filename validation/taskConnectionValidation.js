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

module.exports = {
  validateCreateTaskConnection: validateRequest(createTaskConnectionValidation),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),
  validateConnectionIdParam: validateRequest(
    connectionIdParamValidation,
    "params"
  ),

  schemas: {
    createTaskConnectionValidation,
    taskIdParamValidation,
    connectionIdParamValidation,
  },
};
