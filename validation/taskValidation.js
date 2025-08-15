const Joi = require("joi");
const {
  CUSTOM_FIELD_TYPES,
  TASK_STATUS,
  TASK_PRIORITY,
} = require("../utils/constants");
const { helpers } = require("./authValidation");

// Custom field validation schema
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

// Create task validation schema
const createTaskValidation = Joi.object({
  title: Joi.string().trim().min(1).max(200).required().messages({
    "string.empty": "Task title is required",
    "string.min": "Task title must be at least 1 character long",
    "string.max": "Task title cannot exceed 200 characters",
  }),

  description: Joi.string().trim().max(1000).optional().default("").messages({
    "string.max": "Task description cannot exceed 1000 characters",
  }),

  projectId: helpers.objectIdValidation.optional().messages({
    "string.pattern.name": "Project ID must be a valid ObjectId",
  }),

  channelId: helpers.objectIdValidation.optional().messages({
    "string.pattern.name": "Channel ID must be a valid ObjectId",
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

  attachments: Joi.array()
    .items(Joi.string().uri())
    .optional()
    .default([])
    .messages({
      "array.base": "Attachments must be an array of valid URLs",
      "string.uri": "Each attachment must be a valid URL",
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

  subtasks: Joi.array()
    .items(
      Joi.object({
        title: Joi.string().trim().min(1).max(200).required().messages({
          "string.empty": "Subtask title is required",
          "string.min": "Subtask title must be at least 1 character long",
          "string.max": "Subtask title cannot exceed 200 characters",
        }),
        assignedTo: Joi.array()
          .items(helpers.objectIdValidation)
          .optional()
          .default([])
          .messages({
            "array.base": "Assigned to must be an array of valid user IDs",
          }),
      })
    )
    .optional()
    .default([])
    .messages({
      "array.base": "Subtasks must be an array",
    }),
}).custom((value, helpers) => {
  // Custom validation to ensure either projectId or channelId is provided, but not both
  const { projectId, channelId } = value;
  
  if (!projectId && !channelId) {
    return helpers.error('custom.eitherRequired', {
      message: 'Either projectId or channelId must be provided'
    });
  }
  
  if (projectId && channelId) {
    return helpers.error('custom.mutuallyExclusive', {
      message: 'Cannot provide both projectId and channelId'
    });
  }
  
  return value;
}).messages({
  'custom.eitherRequired': 'Either projectId or channelId must be provided',
  'custom.mutuallyExclusive': 'Cannot provide both projectId and channelId'
});

// Batch update task validation schema
const batchUpdateTaskValidation = Joi.object({
  title: Joi.string().trim().min(1).max(200).optional().messages({
    "string.min": "Task title must be at least 1 character long",
    "string.max": "Task title cannot exceed 200 characters",
  }),

  description: Joi.string().trim().max(1000).optional().messages({
    "string.max": "Task description cannot exceed 1000 characters",
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

  attachments: Joi.array().items(Joi.string().uri()).optional().messages({
    "array.base": "Attachments must be an array of valid URLs",
    "string.uri": "Each attachment must be a valid URL",
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

// Task ID parameter validation
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
      req.query = value;
    } else if (source === "params") {
      req.params = value;
    } else {
      req.body = value;
    }

    next();
  };
};

// Share task validation schema
const shareTaskValidation = Joi.object({
  emails: Joi.array()
    .items(
      Joi.string().email().messages({
        "string.email": "Each email must be a valid email address",
      })
    )
    .min(0)
    .max(20)
    .optional()
    .messages({
      "array.base": "Emails must be an array of email addresses",
      "array.max": "Cannot share with more than 20 people at once",
    }),

  message: Joi.string().trim().max(500).optional().messages({
    "string.max": "Message cannot exceed 500 characters",
  }),

  shareType: Joi.string()
    .valid("link", "email", "both")
    .optional()
    .default("both")
    .messages({
      "any.only": "Share type must be one of: link, email, both",
    }),
});

// Trending tasks query validation
const trendingTasksQueryValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
  timeframe: Joi.string()
    .valid('day', 'week', 'month', 'all')
    .optional()
    .default('all')
    .messages({
      "any.only": "Timeframe must be one of: day, week, month, all"
    }),
  projectId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Invalid project ID format",
    }),
  channelId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Invalid channel ID format",
    }),
});

// Recent activities query validation
const recentActivitiesQueryValidation = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
  projectId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Invalid project ID format",
    }),
  channelId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      "string.pattern.base": "Invalid channel ID format",
    }),
});

module.exports = {
  validateCreateTask: validateRequest(createTaskValidation),
  validateBatchUpdateTask: validateRequest(batchUpdateTaskValidation),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),
  validateShareTask: validateRequest(shareTaskValidation),
  validateTrendingTasksQuery: validateRequest(trendingTasksQueryValidation, "query"),
  validateRecentActivitiesQuery: validateRequest(recentActivitiesQueryValidation, "query"),

  // Export schemas for testing or custom usage
  schemas: {
    createTaskValidation,
    batchUpdateTaskValidation,
    taskIdParamValidation,
    customFieldSchema,
    shareTaskValidation,
    trendingTasksQueryValidation,
    recentActivitiesQueryValidation,
  },
};
