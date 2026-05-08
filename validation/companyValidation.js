const Joi = require("joi");
const { helpers } = require("./authValidation");
const {
  WORK_TYPE,
  CURRENT_ROLE,
  TEAM_QUANTITY,
  ORGANIZATION_QUANTITY,
  SOURCE,
  CHANNEL_PREFERENCE,
} = require("../utils/constants");

// General questions schema for company creation/update
const generalQuestionsSchema = Joi.object({
  workType: Joi.string()
    .valid(...Object.values(WORK_TYPE))
    .required()
    .messages({
      "any.only": `Work type must be one of: ${Object.values(WORK_TYPE).join(
        ", "
      )}`,
      "any.required": "Work type is required",
    }),

  currentRole: Joi.string()
    .valid(...Object.values(CURRENT_ROLE))
    .required()
    .messages({
      "any.only": `Current role must be one of: ${Object.values(
        CURRENT_ROLE
      ).join(", ")}`,
      "any.required": "Current role is required",
    }),

  peopleQuantityInTeam: Joi.string()
    .valid(...Object.values(TEAM_QUANTITY))
    .required()
    .messages({
      "any.only": `Team quantity must be one of: ${Object.values(
        TEAM_QUANTITY
      ).join(", ")}`,
      "any.required": "People quantity in team is required",
    }),

  peopleQuantityInOrganization: Joi.string()
    .valid(...Object.values(ORGANIZATION_QUANTITY))
    .required()
    .messages({
      "any.only": `Organization quantity must be one of: ${Object.values(
        ORGANIZATION_QUANTITY
      ).join(", ")}`,
      "any.required": "People quantity in organization is required",
    }),

  source: Joi.string()
    .valid(...Object.values(SOURCE))
    .required()
    .messages({
      "any.only": `Source must be one of: ${Object.values(SOURCE).join(", ")}`,
      "any.required": "Source is required",
    }),
});

// Create company validation schema
const createCompanyValidation = Joi.object({
  name: Joi.string().trim().min(1).max(100).required().messages({
    "string.empty": "Company name is required",
    "string.min": "Company name must be at least 1 character long",
    "string.max": "Company name cannot exceed 100 characters",
  }),

  domain: Joi.string()
    .trim()
    .pattern(
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    )
    .required()
    .messages({
      "string.empty": "Domain is required",
      "string.pattern.base":
        "Domain must be a valid domain format (e.g., example.com)",
    }),

  adminUser: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Admin user must be a valid user ID",
  }),

  joinToken: Joi.string().trim().min(10).max(100).optional().messages({
    "string.min": "Join token must be at least 10 characters long",
    "string.max": "Join token cannot exceed 100 characters",
  }),

  generalQuestions: generalQuestionsSchema.required().messages({
    "any.required": "General questions are required",
  }),

  channelPreference: Joi.array()
    .items(Joi.string().valid(...Object.values(CHANNEL_PREFERENCE)))
    .min(1)
    .required()
    .messages({
      "array.min": "At least one channel preference is required",
      "any.only": `Channel preference must contain only: ${Object.values(
        CHANNEL_PREFERENCE
      ).join(", ")}`,
      "any.required": "Channel preferences are required",
    }),

  automaticSignups: Joi.boolean().optional().default(false).messages({
    "boolean.base": "Automatic signups must be a boolean value",
  }),

  isActive: Joi.boolean().optional().default(true).messages({
    "boolean.base": "isActive must be a boolean value",
  }),
});

// Update company validation schema
const updateCompanyValidation = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional().messages({
    "string.min": "Company name must be at least 1 character long",
    "string.max": "Company name cannot exceed 100 characters",
  }),

  domain: Joi.string()
    .trim()
    .pattern(
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    )
    .optional()
    .messages({
      "string.pattern.base":
        "Domain must be a valid domain format (e.g., example.com)",
    }),

  adminUser: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Admin user must be a valid user ID",
  }),

  generalQuestions: generalQuestionsSchema.optional(),

  channelPreference: Joi.array()
    .items(Joi.string().valid(...Object.values(CHANNEL_PREFERENCE)))
    .min(1)
    .optional()
    .messages({
      "array.min": "At least one channel preference is required",
      "any.only": `Channel preference must contain only: ${Object.values(
        CHANNEL_PREFERENCE
      ).join(", ")}`,
    }),

  automaticSignups: Joi.boolean().optional().messages({
    "boolean.base": "Automatic signups must be a boolean value",
  }),

  isActive: Joi.boolean().optional().messages({
    "boolean.base": "isActive must be a boolean value",
  }),

  isDeleted: Joi.boolean().optional().messages({
    "boolean.base": "isDeleted must be a boolean value",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Get company query validation
const getCompanyQueryValidation = Joi.object({
  joinToken: Joi.string().trim().min(10).max(100).optional().messages({
    "string.min": "Join token must be at least 10 characters long",
    "string.max": "Join token cannot exceed 100 characters",
  }),

  companyId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Company ID must be a valid ObjectId",
  }),
})
  .or("joinToken", "companyId")
  .messages({
    "object.missing": "Either joinToken or companyId is required",
  });

// Update company query validation
const updateCompanyQueryValidation = Joi.object({
  companyId: helpers.objectIdValidation.required().messages({
    "any.required": "Company ID is required",
    "string.pattern.base": "Company ID must be a valid ObjectId",
  }),
});

// Company ID parameter validation
const companyIdParamValidation = Joi.object({
  companyId: helpers.objectIdValidation.required().messages({
    "any.required": "Company ID is required",
  }),
});

// Companies listing query validation
const getCompaniesQueryValidation = Joi.object({
  search: Joi.string().trim().max(100).optional().messages({
    "string.max": "Search term cannot exceed 100 characters",
  }),

  domain: Joi.string().trim().optional().messages({
    "string.base": "Domain must be a string",
  }),

  isActive: Joi.boolean().optional().messages({
    "boolean.base": "isActive must be a boolean value",
  }),

  isDeleted: Joi.boolean().optional().messages({
    "boolean.base": "isDeleted must be a boolean value",
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
    .valid("name", "domain", "createdAt", "updatedAt")
    .optional()
    .default("createdAt")
    .messages({
      "any.only": "Sort by must be one of: name, domain, createdAt, updatedAt",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("desc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
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
  validateCreateCompany: validateRequest(createCompanyValidation),
  validateUpdateCompany: validateRequest(updateCompanyValidation),
  validateGetCompanyQuery: validateRequest(getCompanyQueryValidation, "query"),
  validateUpdateCompanyQuery: validateRequest(
    updateCompanyQueryValidation,
    "query"
  ),
  validateCompanyIdParam: validateRequest(companyIdParamValidation, "params"),
  validateGetCompaniesQuery: validateRequest(
    getCompaniesQueryValidation,
    "query"
  ),

  // Export constants for reuse
  WORK_TYPE: Object.values(WORK_TYPE),
  CURRENT_ROLE: Object.values(CURRENT_ROLE),
  TEAM_QUANTITY: Object.values(TEAM_QUANTITY),
  ORGANIZATION_QUANTITY: Object.values(ORGANIZATION_QUANTITY),
  SOURCE: Object.values(SOURCE),
  CHANNEL_PREFERENCE: Object.values(CHANNEL_PREFERENCE),

  // Export schemas for testing or custom usage
  schemas: {
    createCompanyValidation,
    updateCompanyValidation,
    getCompanyQueryValidation,
    updateCompanyQueryValidation,
    companyIdParamValidation,
    getCompaniesQueryValidation,
    generalQuestionsSchema,
  },
};
