const Joi = require("joi");
const { helpers } = require("./authValidation");
const { TASK_STATUS, TASK_PRIORITY, CUSTOM_FIELD_TYPES } = require("../utils/constants");

// Custom field validation schema (matches taskValidation.js)
const customFieldSchema = Joi.object({
  name: Joi.string().trim().min(1).max(50).required().messages({
    "string.empty": "Custom field name is required",
    "string.min": "Custom field name must be at least 1 character long",
    "string.max": "Custom field name cannot exceed 50 characters",
  }),

  type: Joi.string()
    .valid(...Object.values(CUSTOM_FIELD_TYPES))
    .required()
    .messages({
      "any.only": `Custom field type must be one of: ${Object.values(
        CUSTOM_FIELD_TYPES
      ).join(", ")}`,
      "string.empty": "Custom field type is required",
    }),

  value: Joi.alternatives()
    .try(
      Joi.string(),
      Joi.number(),
      Joi.boolean(),
      Joi.date(),
      Joi.array().items(Joi.string())
    )
    .optional()
    .messages({
      "alternatives.types":
        "Custom field value must be string, number, boolean, date, or array of strings",
    }),

  options: Joi.when("type", {
    is: CUSTOM_FIELD_TYPES.DROPDOWN,
    then: Joi.array()
      .items(Joi.string().trim().min(1))
      .max(3)
      .min(1)
      .required()
      .messages({
        "array.max": "Dropdown can have maximum 3 options",
        "array.min": "Dropdown must have at least 1 option",
        "any.required": "Options are required for dropdown type",
      }),
    otherwise: Joi.forbidden(),
  }),
});

// Attachment schema (matches taskValidation.js)
const attachmentSchema = Joi.object({
  url: Joi.string().uri().required().messages({
    "string.uri": "Attachment URL must be a valid URL",
    "any.required": "Attachment URL is required",
  }),
  fileName: Joi.string().trim().max(255).optional().messages({
    "string.max": "File name cannot exceed 255 characters",
  }),
  fileSize: Joi.number().integer().min(0).optional().messages({
    "number.base": "File size must be a number",
    "number.min": "File size must be non-negative",
  }),
  mimeType: Joi.string().trim().max(100).optional().messages({
    "string.max": "MIME type cannot exceed 100 characters",
  }),
  uploadedBy: helpers.objectIdValidation.optional().messages({
    "string.pattern.name": "Uploaded by must be a valid user ID",
  }),
  uploadedAt: Joi.date().optional().messages({
    "date.base": "Uploaded at must be a valid date",
  }),
});

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

  tags: Joi.array()
    .items(Joi.string().trim().min(1).max(30))
    .optional()
    .default([])
    .messages({
      "array.base": "Tags must be an array of strings",
      "string.min": "Each tag must be at least 1 character long",
      "string.max": "Each tag cannot exceed 30 characters",
    }),

  strokeColor: Joi.string()
    .pattern(/^#([0-9A-F]{3}){1,2}$/i)
    .optional()
    .default("#6C63FF")
    .messages({
      "string.pattern.base":
        "Stroke color must be a valid hex color (e.g., #6C63FF)",
    }),

  type: Joi.string().optional().default("task").messages({
    "string.base": "Type must be a string",
  }),

  isCompleted: Joi.boolean()
    .optional()
    .default(false)
    .messages({
      "boolean.base": "isCompleted must be a boolean value",
    }),

  attachments: Joi.array()
    .items(attachmentSchema)
    .optional()
    .default([])
    .messages({
      "array.base": "Attachments must be an array of attachment objects",
    }),

  links: Joi.array()
    .items(Joi.string().uri())
    .optional()
    .default([])
    .messages({
      "array.base": "Links must be an array of valid URLs",
      "string.uri": "Each link must be a valid URL",
    }),

  customFields: Joi.array()
    .items(customFieldSchema)
    .optional()
    .default([])
    .messages({
      "array.base": "Custom fields must be an array",
    }),

  checklist: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        isCompleted: Joi.boolean().default(false),
        order: Joi.number().default(0),
      })
    )
    .optional()
    .default([]),
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

  tags: Joi.array()
    .items(Joi.string().trim().min(1).max(30))
    .optional()
    .messages({
      "array.base": "Tags must be an array of strings",
      "string.min": "Each tag must be at least 1 character long",
      "string.max": "Each tag cannot exceed 30 characters",
    }),

  strokeColor: Joi.string()
    .pattern(/^#([0-9A-F]{3}){1,2}$/i)
    .optional()
    .messages({
      "string.pattern.base":
        "Stroke color must be a valid hex color (e.g., #6C63FF)",
    }),

  type: Joi.string().optional().messages({
    "string.base": "Type must be a string",
  }),

  isCompleted: Joi.boolean()
    .optional()
    .messages({
      "boolean.base": "isCompleted must be a boolean value",
    }),

  attachments: Joi.array().items(attachmentSchema).optional().messages({
    "array.base": "Attachments must be an array of attachment objects",
  }),

  links: Joi.array()
    .items(Joi.string().uri())
    .optional()
    .messages({
      "array.base": "Links must be an array of valid URLs",
      "string.uri": "Each link must be a valid URL",
    }),

  customFields: Joi.array().items(customFieldSchema).optional().messages({
    "array.base": "Custom fields must be an array",
  }),

  checklist: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        isCompleted: Joi.boolean().default(false),
        order: Joi.number().default(0),
      })
    )
    .optional(),
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
