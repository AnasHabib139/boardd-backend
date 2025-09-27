const Joi = require("joi");
const { helpers } = require("./authValidation");

// Create project validation schema
const createProjectValidation = Joi.object({
  name: Joi.string().trim().min(1).max(100).required().messages({
    "string.empty": "Project name is required",
    "string.min": "Project name must be at least 1 character long",
    "string.max": "Project name cannot exceed 100 characters",
  }),

  description: Joi.string().trim().max(1000).optional().default("").messages({
    "string.max": "Project description cannot exceed 1000 characters",
  }),

  tabId: helpers.objectIdValidation.required().messages({
    "any.required": "Tab ID is required",
  }),

  startDate: Joi.alternatives()
    .try(
      Joi.date(),
      Joi.string()
        .pattern(/^\d{2}-\d{2}-\d{4}$/)
        .message("Date must be in DD-MM-YYYY format"),
      Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .message("Date must be in YYYY-MM-DD format")
    )
    .optional()
    .messages({
      "alternatives.match":
        "Start date must be a valid date (DD-MM-YYYY, YYYY-MM-DD, or Date object)",
    }),

  endDate: Joi.alternatives()
    .try(
      Joi.date(),
      Joi.string()
        .pattern(/^\d{2}-\d{2}-\d{4}$/)
        .message("Date must be in DD-MM-YYYY format"),
      Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .message("Date must be in YYYY-MM-DD format")
    )
    .optional()
    .messages({
      "alternatives.match":
        "End date must be a valid date (DD-MM-YYYY, YYYY-MM-DD, or Date object)",
    }),

  color: Joi.string()
    .pattern(/^#([0-9A-F]{3}){1,2}$/i)
    .optional()
    .default("#6C63FF")
    .messages({
      "string.pattern.base": "Color must be a valid hex color (e.g., #6C63FF)",
    }),

  priority: Joi.string()
    .valid("low", "medium", "high", "critical")
    .optional()
    .default("medium")
    .messages({
      "any.only": "Priority must be one of: low, medium, high, critical",
    }),

  status: Joi.string()
    .valid("active", "archived")
    .optional()
    .default("active")
    .messages({
      "any.only": "Status must be one of: active, archived",
    }),

  budget: Joi.number().positive().optional().messages({
    "number.base": "Budget must be a number",
    "number.positive": "Budget must be positive",
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

  objectives: Joi.array()
    .items(Joi.string().trim().min(1).max(200))
    .optional()
    .default([])
    .messages({
      "array.base": "Objectives must be an array of strings",
      "string.min": "Each objective must be at least 1 character long",
      "string.max": "Each objective cannot exceed 200 characters",
    }),

  teamMembers: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .default([])
    .messages({
      "array.base": "Team members must be an array of valid user IDs",
    }),

  isPrivate: Joi.boolean().optional().default(false).messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),
});

// Update project validation schema
const updateProjectValidation = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional().messages({
    "string.min": "Project name must be at least 1 character long",
    "string.max": "Project name cannot exceed 100 characters",
  }),

  description: Joi.string().trim().max(1000).optional().messages({
    "string.max": "Project description cannot exceed 1000 characters",
  }),

  startDate: Joi.alternatives()
    .try(
      Joi.date(),
      Joi.string()
        .pattern(/^\d{2}-\d{2}-\d{4}$/)
        .message("Date must be in DD-MM-YYYY format"),
      Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .message("Date must be in YYYY-MM-DD format")
    )
    .optional()
    .messages({
      "alternatives.match":
        "Start date must be a valid date (DD-MM-YYYY, YYYY-MM-DD, or Date object)",
    }),

  endDate: Joi.alternatives()
    .try(
      Joi.date(),
      Joi.string()
        .pattern(/^\d{2}-\d{2}-\d{4}$/)
        .message("Date must be in DD-MM-YYYY format"),
      Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .message("Date must be in YYYY-MM-DD format")
    )
    .optional()
    .messages({
      "alternatives.match":
        "End date must be a valid date (DD-MM-YYYY, YYYY-MM-DD, or Date object)",
    }),

  color: Joi.string()
    .pattern(/^#([0-9A-F]{3}){1,2}$/i)
    .optional()
    .messages({
      "string.pattern.base": "Color must be a valid hex color (e.g., #6C63FF)",
    }),

  priority: Joi.string()
    .valid("low", "medium", "high", "critical")
    .optional()
    .messages({
      "any.only": "Priority must be one of: low, medium, high, critical",
    }),

  status: Joi.string()
    .valid("active", "archived")
    .optional()
    .messages({
      "any.only": "Status must be one of: active, archived",
    }),

  budget: Joi.number().positive().optional().allow(null).messages({
    "number.base": "Budget must be a number",
    "number.positive": "Budget must be positive",
  }),

  tags: Joi.array()
    .items(Joi.string().trim().min(1).max(30))
    .optional()
    .messages({
      "array.base": "Tags must be an array of strings",
      "string.min": "Each tag must be at least 1 character long",
      "string.max": "Each tag cannot exceed 30 characters",
    }),

  objectives: Joi.array()
    .items(Joi.string().trim().min(1).max(200))
    .optional()
    .messages({
      "array.base": "Objectives must be an array of strings",
      "string.min": "Each objective must be at least 1 character long",
      "string.max": "Each objective cannot exceed 200 characters",
    }),

  teamMembers: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .messages({
      "array.base": "Team members must be an array of valid user IDs",
    }),

  isPrivate: Joi.boolean().optional().messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Project ID parameter validation
const projectIdParamValidation = Joi.object({
  projectId: helpers.objectIdValidation.required().messages({
    "any.required": "Project ID is required",
  }),
});

// Tab ID parameter validation for projects
const tabIdParamValidation = Joi.object({
  tabId: helpers.objectIdValidation.required().messages({
    "any.required": "Tab ID is required",
  }),
});

// Channel and Tab ID parameter validation for projects route
const channelTabParamValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),
  tabId: helpers.objectIdValidation.required().messages({
    "any.required": "Tab ID is required",
  }),
});

// Query validation for getting projects
const getProjectsQueryValidation = Joi.object({
  view: Joi.string()
    .valid("overview", "list", "calendar", "board")
    .optional()
    .default("list")
    .messages({
      "any.only": "View must be one of: overview, list, calendar",
    }),

  // Calendar view parameters
  currentDate: Joi.date()
    .optional()
    .when("view", {
      is: "calendar",
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      "date.base": "Current date must be a valid date",
      "any.required": "Current date is required for calendar view",
    }),

  tabId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Tab ID must be a valid ObjectId",
  }),

  channelId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Channel ID must be a valid ObjectId",
  }),

  status: Joi.string()
    .valid("active", "archived")
    .optional()
    .messages({
      "any.only": "Status must be one of: active, archived",
    }),

  priority: Joi.string()
    .valid("low", "medium", "high", "critical")
    .optional()
    .messages({
      "any.only": "Priority must be one of: low, medium, high, critical",
    }),

  createdBy: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Created by must be a valid ObjectId",
  }),

  search: Joi.string().trim().max(100).optional().messages({
    "string.max": "Search term cannot exceed 100 characters",
  }),

  startDate: Joi.date().optional().messages({
    "date.base":
      "Start date must be a valid date (YYYY-MM-DD, DD-MM-YYYY, or ISO format)",
  }),

  endDate: Joi.date()
    .optional()
    .when("startDate", {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref("startDate")),
      otherwise: Joi.optional(),
    })
    .messages({
      "date.base":
        "End date must be a valid date (YYYY-MM-DD, DD-MM-YYYY, or ISO format)",
      "date.min": "End date must be after start date",
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

  sortBy: Joi.string()
    .valid("name", "createdAt", "startDate", "endDate", "priority", "status")
    .optional()
    .default("createdAt")
    .messages({
      "any.only":
        "Sort by must be one of: name, createdAt, startDate, endDate, priority, status",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("desc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
    }),
});

// Duplicate project validation schema
const duplicateProjectValidation = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional().messages({
    "string.empty": "Project name cannot be empty if provided",
    "string.min": "Project name must be at least 1 character long",
    "string.max": "Project name cannot exceed 100 characters",
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
  validateCreateProject: validateRequest(createProjectValidation),
  validateUpdateProject: validateRequest(updateProjectValidation),
  validateProjectIdParam: validateRequest(projectIdParamValidation, "params"),
  validateTabIdParam: validateRequest(tabIdParamValidation, "params"),
  validateChannelTabParams: validateRequest(
    channelTabParamValidation,
    "params"
  ),
  validateGetProjectsQuery: validateRequest(
    getProjectsQueryValidation,
    "query"
  ),
  validateDuplicateProject: validateRequest(duplicateProjectValidation),

  // Export schemas for testing or custom usage
  schemas: {
    createProjectValidation,
    updateProjectValidation,
    projectIdParamValidation,
    tabIdParamValidation,
    channelTabParamValidation,
    getProjectsQueryValidation,
    duplicateProjectValidation,
  },
};
