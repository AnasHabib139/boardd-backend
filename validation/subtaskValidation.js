const Joi = require("joi");
const { helpers } = require("./authValidation");
const { TASK_STATUS, TASK_PRIORITY } = require("../utils/constants");

// Create subtask validation schema
const createSubtaskValidation = Joi.object({
  title: Joi.string().trim().min(1).max(200).required().messages({
    "string.empty": "Subtask title is required",
    "string.min": "Subtask title must be at least 1 character long",
    "string.max": "Subtask title cannot exceed 200 characters",
  }),

  description: Joi.string().trim().max(500).optional().default("").messages({
    "string.max": "Subtask description cannot exceed 500 characters",
  }),

  taskId: helpers.objectIdValidation.required().messages({
    "any.required": "Task ID is required",
  }),

  assignedTo: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .default([])
    .messages({
      "array.base": "Assigned to must be an array of valid user IDs",
    }),

  status: Joi.string()
    .valid(...Object.values(TASK_STATUS))
    .optional()
    .default(TASK_STATUS.TODO)
    .messages({
      "any.only": `Status must be one of: ${Object.values(TASK_STATUS).join(
        ", "
      )}`,
    }),

  priority: Joi.string()
    .valid(...Object.values(TASK_PRIORITY))
    .optional()
    .default(TASK_PRIORITY.MEDIUM)
    .messages({
      "any.only": `Priority must be one of: ${Object.values(TASK_PRIORITY).join(
        ", "
      )}`,
    }),

  dueDate: Joi.date().optional().messages({
    "date.base": "Due date must be a valid date",
  }),

  strokeColor: Joi.string()
    .pattern(/^#([0-9A-F]{3}){1,2}$/i)
    .optional()
    .default("#6C63FF")
    .messages({
      "string.pattern.base":
        "Stroke color must be a valid hex color (e.g., #6C63FF)",
    }),

  isCompleted: Joi.boolean()
    .optional()
    .default(false)
    .messages({
      "boolean.base": "isCompleted must be a boolean value",
    }),
});

// Update subtask validation schema
const updateSubtaskValidation = Joi.object({
  title: Joi.string().trim().min(1).max(200).optional().messages({
    "string.min": "Subtask title must be at least 1 character long",
    "string.max": "Subtask title cannot exceed 200 characters",
  }),

  description: Joi.string().trim().max(500).optional().messages({
    "string.max": "Subtask description cannot exceed 500 characters",
  }),

  assignedTo: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .messages({
      "array.base": "Assigned to must be an array of valid user IDs",
    }),

  status: Joi.string()
    .valid(...Object.values(TASK_STATUS))
    .optional()
    .messages({
      "any.only": `Status must be one of: ${Object.values(TASK_STATUS).join(
        ", "
      )}`,
    }),

  priority: Joi.string()
    .valid(...Object.values(TASK_PRIORITY))
    .optional()
    .messages({
      "any.only": `Priority must be one of: ${Object.values(TASK_PRIORITY).join(
        ", "
      )}`,
    }),

  dueDate: Joi.date().optional().allow(null).messages({
    "date.base": "Due date must be a valid date",
  }),

  strokeColor: Joi.string()
    .pattern(/^#([0-9A-F]{3}){1,2}$/i)
    .optional()
    .messages({
      "string.pattern.base":
        "Stroke color must be a valid hex color (e.g., #6C63FF)",
    }),

  isCompleted: Joi.boolean()
    .optional()
    .messages({
      "boolean.base": "isCompleted must be a boolean value",
    }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Subtask ID parameter validation
const subtaskIdParamValidation = Joi.object({
  subtaskId: helpers.objectIdValidation.required().messages({
    "any.required": "Subtask ID is required",
  }),
});

// Task ID parameter validation for subtasks
const taskIdParamValidation = Joi.object({
  taskId: helpers.objectIdValidation.required().messages({
    "any.required": "Task ID is required",
  }),
});

// Query validation for getting subtasks
const getSubtasksQueryValidation = Joi.object({
  taskId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Task ID must be a valid ObjectId",
  }),

  status: Joi.string()
    .valid("todo", "in_progress", "completed")
    .optional()
    .messages({
      "any.only": "Status must be one of: todo, in_progress, completed",
    }),

  assignedTo: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Assigned to must be a valid ObjectId",
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
  validateCreateSubtask: validateRequest(createSubtaskValidation),
  validateUpdateSubtask: validateRequest(updateSubtaskValidation),
  validateSubtaskIdParam: validateRequest(subtaskIdParamValidation, "params"),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),
  validateGetSubtasksQuery: validateRequest(
    getSubtasksQueryValidation,
    "query"
  ),

  // Export schemas for testing or custom usage
  schemas: {
    createSubtaskValidation,
    updateSubtaskValidation,
    subtaskIdParamValidation,
    taskIdParamValidation,
    getSubtasksQueryValidation,
  },
};
