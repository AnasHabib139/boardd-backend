const Joi = require("joi");
const {
  CUSTOM_FIELD_TYPES,
  TASK_STATUS,
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

// Attachment schema - matches channel files structure
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

// Create task validation schema (simplified)
const createTaskValidation = Joi.object({
  title: Joi.string().trim().min(1).max(200).required().messages({
    "string.empty": "Task title is required",
    "string.min": "Task title must be at least 1 character long",
    "string.max": "Task title cannot exceed 200 characters",
  }),

  projectId: helpers.objectIdValidation.optional().messages({
    "string.pattern.name": "Project ID must be a valid ObjectId",
  }),

  channelId: helpers.objectIdValidation.optional().messages({
    "string.pattern.name": "Channel ID must be a valid ObjectId",
  }),

  tabId: helpers.objectIdValidation.optional().messages({
    "string.pattern.name": "Tab ID must be a valid ObjectId",
  }),

  status: Joi.string()
    .pattern(/^(todo|in_progress|completed|status_\d+)$/)
    .optional()
    .default(TASK_STATUS.TODO)
    .messages({
      "string.pattern.base": "Status must be a valid system status (todo, in_progress, completed) or custom status key (status_<timestamp>)",
    }),

  assignedTo: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .default([])
    .messages({
      "array.base": "Assigned to must be an array of valid user IDs",
    }),

  priority: Joi.string()
    .trim()
    .max(50)
    .optional()
    .default("medium")
    .messages({
      "string.max": "Priority cannot exceed 50 characters",
    }),

  dueDate: Joi.date().optional().messages({
    "date.base": "Due date must be a valid date",
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

  columnValues: Joi.object()
    .pattern(Joi.string(), Joi.any())
    .optional()
    .default({})
    .messages({
      "object.base": "Column values must be an object",
    }),
}).custom((value, helpers) => {
  // Custom validation to ensure either projectId or channelId is provided, but not both
  const { projectId, channelId, tabId } = value;

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

  // If channelId is provided (open task), tabId is required
  if (channelId && !tabId) {
    return helpers.error('custom.tabIdRequired', {
      message: 'tabId is required when creating an open task (channelId without projectId)'
    });
  }

  // If projectId is provided (project task), tabId should not be provided
  if (projectId && tabId) {
    return helpers.error('custom.tabIdForbidden', {
      message: 'tabId should not be provided for project tasks (derived from project)'
    });
  }

  return value;
}).messages({
  'custom.eitherRequired': 'Either projectId or channelId must be provided',
  'custom.mutuallyExclusive': 'Cannot provide both projectId and channelId',
  'custom.tabIdRequired': 'tabId is required when creating an open task (channelId without projectId)',
  'custom.tabIdForbidden': 'tabId should not be provided for project tasks (derived from project)'
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
    .pattern(/^(todo|in_progress|completed|status_\d+)$/)
    .optional()
    .messages({
      "string.pattern.base": "Status must be a valid system status (todo, in_progress, completed) or custom status key (status_<timestamp>)",
    }),

  priority: Joi.string()
    .trim()
    .max(50)
    .optional()
    .messages({
      "string.max": "Priority cannot exceed 50 characters",
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

  attachments: Joi.array().items(attachmentSchema).optional().messages({
    "array.base": "Attachments must be an array of attachment objects",
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

  columnValues: Joi.object()
    .pattern(Joi.string(), Joi.any())
    .optional()
    .messages({
      "object.base": "Column values must be an object",
    }),
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

// Task filter query validation
const taskFilterQueryValidation = Joi.object({
  filter: Joi.string()
    .valid('today', 'overdue', 'yesterday', 'lastweek')
    .required()
    .messages({
      "any.only": "Filter must be one of: today, overdue, yesterday, lastweek",
      "any.required": "Filter is required",
    }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = {
  validateCreateTask: validateRequest(createTaskValidation),
  validateBatchUpdateTask: validateRequest(batchUpdateTaskValidation),
  validateTaskIdParam: validateRequest(taskIdParamValidation, "params"),
  validateShareTask: validateRequest(shareTaskValidation),
  validateTrendingTasksQuery: validateRequest(trendingTasksQueryValidation, "query"),
  validateRecentActivitiesQuery: validateRequest(recentActivitiesQueryValidation, "query"),
  validateTaskFilterQuery: validateRequest(taskFilterQueryValidation, "query"),

  // Export schemas for testing or custom usage
  schemas: {
    createTaskValidation,
    batchUpdateTaskValidation,
    taskIdParamValidation,
    customFieldSchema,
    shareTaskValidation,
    trendingTasksQueryValidation,
    recentActivitiesQueryValidation,
    taskFilterQueryValidation,
  },
};
