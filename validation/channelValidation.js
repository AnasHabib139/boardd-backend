const Joi = require("joi");
const { helpers } = require("./authValidation");

// Create channel validation schema
const createChannelValidation = Joi.object({
  channelName: Joi.string().trim().min(1).max(100).required().messages({
    "string.empty": "Channel name is required",
    "string.min": "Channel name must be at least 1 character long",
    "string.max": "Channel name cannot exceed 100 characters",
    "any.required": "Channel name is required",
  }),

  channelDescription: Joi.string().trim().min(1).max(500).required().messages({
    "string.empty": "Channel description is required",
    "string.min": "Channel description must be at least 1 character long",
    "string.max": "Channel description cannot exceed 500 characters",
    "any.required": "Channel description is required",
  }),

  isPrivate: Joi.boolean().optional().default(false).messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),

  companyId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Company ID must be a valid ObjectId",
  }),

  members: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .default([])
    .messages({
      "array.base": "Members must be an array of valid user IDs",
    }),

  tabs: Joi.array()
    .items(helpers.objectIdValidation)
    .optional()
    .default([])
    .messages({
      "array.base": "Tabs must be an array of valid tab IDs",
    }),
});

// Update channel validation schema
const updateChannelValidation = Joi.object({
  channelName: Joi.string().trim().allow('').max(100).optional().messages({
    "string.max": "Channel name cannot exceed 100 characters",
  }),

  channelDescription: Joi.string().trim().allow('').max(500).optional().messages({
    "string.max": "Channel description cannot exceed 500 characters",
  }),

  isPrivate: Joi.boolean().optional().messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),

  members: Joi.array().items(helpers.objectIdValidation).optional().messages({
    "array.base": "Members must be an array of valid user IDs",
  }),

  tabs: Joi.array().items(helpers.objectIdValidation).optional().messages({
    "array.base": "Tabs must be an array of valid tab IDs",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Add user to channel validation schema
const addUserToChannelValidation = Joi.object({
  emails: Joi.array()
    .items(
      Joi.string()
        .custom((value, helpers) => {
          // Allow the specific demo email
          if (value.toLowerCase() === "uncle@boardd.demo") {
            return value;
          }

          // For all other emails, use standard email validation
          const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
          if (!emailPattern.test(value)) {
            return helpers.error("string.email");
          }

          return value;
        })
        .messages({
          "string.email": "Each email must be a valid email address",
        })
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      "array.base": "Emails must be an array of email addresses",
      "array.min": "At least one email is required",
      "array.max": "Cannot add more than 50 users at once",
      "any.required": "Emails array is required",
    }),

  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),
});

// Remove user from channel validation schema
const removeUserFromChannelValidation = Joi.object({
  userId: helpers.objectIdValidation.required().messages({
    "any.required": "User ID is required",
  }),

  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),
});

// Channel ID parameter validation
const channelIdParamValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),
});

// Channel token parameter validation
const channelTokenParamValidation = Joi.object({
  channelToken: Joi.string().trim().min(10).max(100).required().messages({
    "string.empty": "Channel token is required",
    "string.min": "Channel token must be at least 10 characters long",
    "string.max": "Channel token cannot exceed 100 characters",
    "any.required": "Channel token is required",
  }),
});

// Get channel joining link query validation
const getChannelJoiningLinkQueryValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),
});

// Get all members in channel query validation
const getAllMembersInChannelQueryValidation = Joi.object({
  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
  }),

  search: Joi.string().trim().max(100).optional().messages({
    "string.max": "Search term cannot exceed 100 characters",
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
    .default(10)
    .messages({
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
      "number.integer": "Limit must be an integer",
    }),

  sortBy: Joi.string()
    .valid("name", "email", "role", "joinedAt", "isActive")
    .optional()
    .default("name")
    .messages({
      "any.only":
        "Sort by must be one of: name, email, role, joinedAt, isActive",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("asc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
    }),
});

// Get all channels of user query validation
const getAllChannelsOfUserQueryValidation = Joi.object({
  search: Joi.string().trim().max(100).optional().messages({
    "string.max": "Search term cannot exceed 100 characters",
  }),

  isPrivate: Joi.boolean().optional().messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),

  includeArchived: Joi.boolean().optional().default(false).messages({
    "boolean.base": "includeArchived must be a boolean value",
  }),

  hasMembers: Joi.boolean().optional().messages({
    "boolean.base": "hasMembers must be a boolean value",
  }),

  memberCount: Joi.object({
    min: Joi.number().integer().min(0).optional().messages({
      "number.min": "Minimum member count must be at least 0",
      "number.integer": "Minimum member count must be an integer",
    }),
    max: Joi.number().integer().min(1).optional().messages({
      "number.min": "Maximum member count must be at least 1",
      "number.integer": "Maximum member count must be an integer",
    }),
  })
    .optional()
    .messages({
      "object.base": "Member count filter must be an object",
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

  sortBy: Joi.string()
    .valid("channelName", "createdAt", "memberCount", "isPrivate")
    .optional()
    .default("channelName")
    .messages({
      "any.only":
        "Sort by must be one of: channelName, createdAt, memberCount, isPrivate",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("asc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
    }),
});

// Get channels query validation (for admin listing all channels)
const getChannelsQueryValidation = Joi.object({
  search: Joi.string().trim().max(100).optional().messages({
    "string.max": "Search term cannot exceed 100 characters",
  }),

  isPrivate: Joi.boolean().optional().messages({
    "boolean.base": "isPrivate must be a boolean value",
  }),

  companyId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Company ID must be a valid ObjectId",
  }),

  createdBy: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Created by must be a valid user ID",
  }),

  hasMembers: Joi.boolean().optional().messages({
    "boolean.base": "hasMembers must be a boolean value",
  }),

  memberCount: Joi.number().integer().min(0).optional().messages({
    "number.min": "Member count must be at least 0",
    "number.integer": "Member count must be an integer",
  }),

  createdAfter: Joi.date().optional().messages({
    "date.base": "Created after must be a valid date",
  }),

  createdBefore: Joi.date().optional().messages({
    "date.base": "Created before must be a valid date",
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
    .valid("channelName", "createdAt", "updatedAt", "isPrivate", "memberCount")
    .optional()
    .default("createdAt")
    .messages({
      "any.only":
        "Sort by must be one of: channelName, createdAt, updatedAt, isPrivate, memberCount",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("desc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
    }),
});

// Join channel by token validation schema
const joinChannelByTokenValidation = Joi.object({
  channelToken: Joi.string().trim().min(10).max(100).required().messages({
    "string.empty": "Channel token is required",
    "string.min": "Channel token must be at least 10 characters long",
    "string.max": "Channel token cannot exceed 100 characters",
    "any.required": "Channel token is required",
  }),
});

// Send channel invite emails validation schema
const sendChannelInviteEmailsValidation = Joi.object({
  emails: Joi.array()
    .items(
      Joi.string().email().messages({
        "string.email": "Each email must be a valid email address",
      })
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      "array.base": "Emails must be an array of email addresses",
      "array.min": "At least one email is required",
      "array.max": "Cannot send invites to more than 50 emails at once",
      "any.required": "Emails array is required",
    }),

  allowGuests: Joi.boolean().optional().default(false).messages({
    "boolean.base": "allowGuests must be a boolean value",
  }),

  channelDescription: Joi.string().trim().max(500).optional().messages({
    "string.max": "Channel description cannot exceed 500 characters",
  }),
});

// Join channel with invite token validation schema
const joinChannelWithInviteValidation = Joi.object({
  token: Joi.string().trim().min(10).required().messages({
    "string.empty": "Invite token is required",
    "string.min": "Invite token must be at least 10 characters long",
    "any.required": "Invite token is required",
  }),

  flow: Joi.string().valid("guest", "company").required().messages({
    "any.only": "Flow must be either 'guest' or 'company'",
    "any.required": "Flow is required",
  }),

  channelId: helpers.objectIdValidation.required().messages({
    "any.required": "Channel ID is required",
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
  validateCreateChannel: validateRequest(createChannelValidation),
  validateUpdateChannel: validateRequest(updateChannelValidation),
  validateAddUserToChannel: validateRequest(addUserToChannelValidation),
  validateRemoveUserFromChannel: validateRequest(
    removeUserFromChannelValidation
  ),
  validateChannelIdParam: validateRequest(channelIdParamValidation, "params"),
  validateChannelTokenParam: validateRequest(
    channelTokenParamValidation,
    "params"
  ),
  validateGetChannelJoiningLinkQuery: validateRequest(
    getChannelJoiningLinkQueryValidation,
    "query"
  ),
  validateGetAllMembersInChannelQuery: validateRequest(
    getAllMembersInChannelQueryValidation,
    "query"
  ),
  validateGetAllChannelsOfUserQuery: validateRequest(
    getAllChannelsOfUserQueryValidation,
    "query"
  ),
  validateGetChannelsQuery: validateRequest(
    getChannelsQueryValidation,
    "query"
  ),
  validateJoinChannelByToken: validateRequest(joinChannelByTokenValidation),
  validateSendChannelInviteEmails: validateRequest(
    sendChannelInviteEmailsValidation
  ),
  validateJoinChannelWithInvite: validateRequest(
    joinChannelWithInviteValidation
  ),
  validateEditChannel: validateRequest(updateChannelValidation),

  // Export schemas for testing or custom usage
  schemas: {
    createChannelValidation,
    updateChannelValidation,
    addUserToChannelValidation,
    removeUserFromChannelValidation,
    channelIdParamValidation,
    channelTokenParamValidation,
    getChannelJoiningLinkQueryValidation,
    getAllMembersInChannelQueryValidation,
    getAllChannelsOfUserQueryValidation,
    getChannelsQueryValidation,
    joinChannelByTokenValidation,
    sendChannelInviteEmailsValidation,
    joinChannelWithInviteValidation,
  },
};
