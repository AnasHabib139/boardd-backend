const Joi = require("joi");
const { helpers } = require("./authValidation");

// Valid action types from the schema
const ACTIVITY_ACTION_TYPES = [
  "CREATE_TASK",
  "UPDATE_TASK",
  "DELETE_TASK",
  "CREATE_SUBTASK",
  "UPDATE_SUBTASK",
  "DELETE_SUBTASK",
  "ASSIGN_USER",
  "CHANGE_STATUS",
  "CHANGE_PRIORITY",
  "CHANGE_DUE_DATE",
  "ADD_TAG",
  "REMOVE_TAG",
  "ADD_DESCRIPTION",
  "UPDATE_DESCRIPTION",
  "ADD_STROKE_COLOR",
  "UPDATE_STROKE_COLOR",
  "ADD_CUSTOM_FIELD",
  "UPDATE_CUSTOM_FIELD",
  "DELETE_CUSTOM_FIELD",
];

// Create activity validation schema
const createActivityValidation = Joi.object({
  projectId: helpers.objectIdValidation.required().messages({
    "any.required": "Project ID is required",
  }),

  taskId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Task ID must be a valid ObjectId",
  }),

  subtaskId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Subtask ID must be a valid ObjectId",
  }),

  userId: helpers.objectIdValidation.required().messages({
    "any.required": "User ID is required",
  }),

  actionType: Joi.string()
    .valid(...ACTIVITY_ACTION_TYPES)
    .required()
    .messages({
      "any.only": `Action type must be one of: ${ACTIVITY_ACTION_TYPES.join(
        ", "
      )}`,
      "any.required": "Action type is required",
    }),

  field: Joi.string().trim().max(100).optional().messages({
    "string.max": "Field name cannot exceed 100 characters",
  }),

  previousValue: Joi.alternatives()
    .try(
      Joi.string(),
      Joi.number(),
      Joi.boolean(),
      Joi.date(),
      Joi.array(),
      Joi.object(),
      Joi.allow(null)
    )
    .optional()
    .messages({
      "alternatives.types":
        "Previous value can be string, number, boolean, date, array, object, or null",
    }),

  newValue: Joi.alternatives()
    .try(
      Joi.string(),
      Joi.number(),
      Joi.boolean(),
      Joi.date(),
      Joi.array(),
      Joi.object(),
      Joi.allow(null)
    )
    .optional()
    .messages({
      "alternatives.types":
        "New value can be string, number, boolean, date, array, object, or null",
    }),

  message: Joi.object({
    forCreator: Joi.string().trim().max(500).optional().messages({
      "string.max": "Creator message cannot exceed 500 characters",
    }),

    forOthers: Joi.string().trim().max(500).optional().messages({
      "string.max": "Others message cannot exceed 500 characters",
    }),
  })
    .optional()
    .messages({
      "object.base":
        "Message must be an object with forCreator and/or forOthers fields",
    }),

  timestamp: Joi.date()
    .optional()
    .default(() => new Date())
    .messages({
      "date.base": "Timestamp must be a valid date",
    }),
});

// Get activities query validation
const getActivitiesQueryValidation = Joi.object({
  projectId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Project ID must be a valid ObjectId",
  }),

  taskId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Task ID must be a valid ObjectId",
  }),

  page: Joi.number().integer().min(1).optional().default(1).messages({
    "number.min": "Page must be at least 1",
    "number.integer": "Page must be an integer",
  }),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .messages({
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
      "number.integer": "Limit must be an integer",
    }),

  actionType: Joi.string()
    .valid(...ACTIVITY_ACTION_TYPES)
    .optional()
    .messages({
      "any.only": `Action type must be one of: ${ACTIVITY_ACTION_TYPES.join(
        ", "
      )}`,
    }),

  userId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "User ID must be a valid ObjectId",
  }),

  startDate: Joi.date().optional().messages({
    "date.base": "Start date must be a valid date",
  }),

  endDate: Joi.date()
    .optional()
    .when("startDate", {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref("startDate")),
      otherwise: Joi.optional(),
    })
    .messages({
      "date.base": "End date must be a valid date",
      "date.min": "End date must be after start date",
    }),
});

// Activity ID parameter validation
const activityIdParamValidation = Joi.object({
  activityId: helpers.objectIdValidation.required().messages({
    "any.required": "Activity ID is required",
  }),
});

// Project ID parameter validation for activities
const projectIdParamValidation = Joi.object({
  projectId: helpers.objectIdValidation.required().messages({
    "any.required": "Project ID is required",
  }),
});

// Task ID parameter validation for activities
const taskIdParamValidation = Joi.object({
  taskId: helpers.objectIdValidation.required().messages({
    "any.required": "Task ID is required",
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
  validateCreateActivity: validateRequest(createActivityValidation),
  validateGetActivitiesQuery: validateRequest(
    getActivitiesQueryValidation,
    "query"
  ),
  validateActivityIdParam: validateRequest(activityIdParamValidation, "params"),
  validateProjectIdParam: validateRequest(projectIdParamValidation, "params"),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),

  // Export constants for reuse
  ACTIVITY_ACTION_TYPES,

  // Export schemas for testing or custom usage
  schemas: {
    createActivityValidation,
    getActivitiesQueryValidation,
    activityIdParamValidation,
    projectIdParamValidation,
    taskIdParamValidation,
  },
};
