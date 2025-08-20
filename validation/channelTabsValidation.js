const Joi = require("joi");
const { helpers } = require("./authValidation");
const { DEFAULT_TABS } = require("../utils/constants");

// Create channel tab validation schema
const createChannelTabValidation = Joi.object({
  tabName: Joi.string().trim().min(1).max(50).required().messages({
    "string.empty": "Tab name is required",
    "string.min": "Tab name must be at least 1 character long",
    "string.max": "Tab name cannot exceed 50 characters",
  }),

  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),

  tabDescription: Joi.string().trim().max(500).optional().default("").messages({
    "string.max": "Tab description cannot exceed 500 characters",
  }),

  isPrivate: Joi.boolean().optional().default(false).messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),

  isDefault: Joi.boolean().optional().default(false).messages({
    "boolean.base": "isDefault must be a boolean value",
  }),

  members: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .default([])
    .messages({
      "array.base": "Members must be an array of valid user IDs",
    }),
});

// Create selected channel tabs validation schema
const createSelectedChannelTabsValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),

  tabs: Joi.array()
    .items(
      Joi.object({
        tabName: Joi.string()
          .valid(...Object.values(DEFAULT_TABS))
          .required()
          .messages({
            "any.only": `Tab name must be one of: ${Object.values(
              DEFAULT_TABS
            ).join(", ")}`,
            "any.required": "Tab name is required",
          }),

        isPrivate: Joi.boolean().optional().default(false).messages({
          "boolean.base": "isPrivate must be a boolean value",
        }),

        members: Joi.array()
          .items(helpers.objectIdValidation)
          .optional()
          .default([])
          .when("isPrivate", {
            is: true,
            then: Joi.optional(),
            otherwise: Joi.forbidden().messages({
              "any.unknown": "Members can only be specified for private tabs",
            }),
          })
          .messages({
            "array.base": "Members must be an array of valid user IDs",
          }),
      })
    )
    .min(1)
    .required()
    .messages({
      "array.min": "At least one tab must be specified",
      "any.required": "Tabs array is required",
    }),
});

// Update channel tab validation schema
const updateChannelTabValidation = Joi.object({
  tabName: Joi.string().trim().min(1).max(50).optional().messages({
    "string.min": "Tab name must be at least 1 character long",
    "string.max": "Tab name cannot exceed 50 characters",
  }),

  tabDescription: Joi.string().trim().max(500).optional().messages({
    "string.max": "Tab description cannot exceed 500 characters",
  }),

  isPrivate: Joi.boolean().optional().messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),

  isDefault: Joi.boolean().optional().messages({
    "boolean.base": "isDefault must be a boolean value",
  }),

  members: Joi.array().items(helpers.objectIdValidation).optional().messages({
    "array.base": "Members must be an array of valid user IDs",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Add members to channel tab validation schema
const addMembersToChannelTabValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),

  assignments: Joi.array()
    .items(
      Joi.object({
        tabId: helpers.objectIdValidation.required().messages({
          "any.required": "Tab ID is required in assignment",
        }),

        memberids: Joi.array()
          .items(helpers.objectIdValidation)
          .min(1)
          .required()
          .messages({
            "array.min": "At least one member ID is required in assignment",
            "any.required": "Member IDs are required in assignment",
            "array.base": "Member IDs must be an array of valid user IDs",
          }),
      }).required()
    )
    .min(1)
    .required()
    .messages({
      "array.min": "At least one assignment is required",
      "any.required": "Assignments are required",
      "array.base": "Assignments must be an array",
    }),
});

// Remove members from channel tab validation schema
const removeMembersFromChannelTabValidation = Joi.object({
  tabId: helpers.objectIdValidation.required().messages({
    "any.required": "Tab ID is required",
  }),

  memberIds: Joi.array()
    .items(helpers.objectIdValidation)
    .min(1)
    .required()
    .messages({
      "array.min": "At least one member ID is required",
      "any.required": "Member IDs are required",
      "array.base": "Member IDs must be an array of valid user IDs",
    }),
});

// Tab ID parameter validation
const tabIdParamValidation = Joi.object({
  tabId: helpers.objectIdValidation.required().messages({
    "any.required": "Tab ID is required",
  }),
});

// Channel ID parameter validation for tabs
const channelIdParamValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),
});

// Get channel tabs query validation
const getChannelTabsQueryValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),

  userId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "User ID must be a valid ObjectId",
  }),

  isPrivate: Joi.boolean().optional().messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),

  isDefault: Joi.boolean().optional().messages({
    "boolean.base": "isDefault must be a boolean value",
  }),

  search: Joi.string().trim().max(50).optional().messages({
    "string.max": "Search term cannot exceed 50 characters",
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
    .valid("tabName", "createdAt", "updatedAt", "isDefault")
    .optional()
    .default("createdAt")
    .messages({
      "any.only":
        "Sort by must be one of: tabName, createdAt, updatedAt, isDefault",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("desc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
    }),
});

// Get tab members query validation
const getTabMembersQueryValidation = Joi.object({
  search: Joi.string().trim().max(50).optional().messages({
    "string.max": "Search term cannot exceed 50 characters",
  }),

  role: Joi.string().valid("admin", "employee", "viewer").optional().messages({
    "any.only": "Role must be one of: admin, employee, viewer",
  }),

  isActive: Joi.boolean().optional().messages({
    "boolean.base": "isActive must be a boolean value",
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
    .valid("name", "email", "role", "joinedAt")
    .optional()
    .default("name")
    .messages({
      "any.only": "Sort by must be one of: name, email, role, joinedAt",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("asc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
    }),
});

// Get all tabs of channel query validation (for members endpoint)
const getAllTabsOfChannelQueryValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
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
    .default(10)
    .messages({
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
      "number.integer": "Limit must be an integer",
    }),
});

// Toggle channel tab validation schema
const toggleChannelTabValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),

  tabName: Joi.string()
    .valid(...Object.values(DEFAULT_TABS))
    .required()
    .messages({
      "any.required": "Tab name is required",
      "any.only": `Tab name must be one of: ${Object.values(DEFAULT_TABS).join(", ")}`,
    }),

  isPrivate: Joi.boolean().optional().default(false).messages({
    "boolean.base": "isPrivate must be a boolean value",
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
  validateCreateChannelTab: validateRequest(createChannelTabValidation),
  validateCreateSelectedChannelTabs: validateRequest(
    createSelectedChannelTabsValidation
  ),
  validateUpdateChannelTab: validateRequest(updateChannelTabValidation),
  validateAddMembersToChannelTab: validateRequest(
    addMembersToChannelTabValidation
  ),
  validateRemoveMembersFromChannelTab: validateRequest(
    removeMembersFromChannelTabValidation
  ),
  validateTabIdParam: validateRequest(tabIdParamValidation, "params"),
  validateChannelIdParam: validateRequest(channelIdParamValidation, "params"),
  validateGetChannelTabsQuery: validateRequest(
    getChannelTabsQueryValidation,
    "query"
  ),
  validateGetTabMembersQuery: validateRequest(
    getTabMembersQueryValidation,
    "query"
  ),
  validateGetAllTabsOfChannelQuery: validateRequest(
    getAllTabsOfChannelQueryValidation,
    "query"
  ),
  validateToggleChannelTab: validateRequest(toggleChannelTabValidation),

  // Export schemas for testing or custom usage
  schemas: {
    createChannelTabValidation,
    createSelectedChannelTabsValidation,
    updateChannelTabValidation,
    addMembersToChannelTabValidation,
    removeMembersFromChannelTabValidation,
    tabIdParamValidation,
    channelIdParamValidation,
    getChannelTabsQueryValidation,
    getTabMembersQueryValidation,
    getAllTabsOfChannelQueryValidation,
  },
};
