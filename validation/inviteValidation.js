const Joi = require("joi");
const { helpers } = require("./authValidation");
const { ROLES } = require("../utils/constants");

// Get unused invite slot query validation
const getUnusedInviteSlotQueryValidation = Joi.object({
  joinToken: Joi.string().trim().min(10).max(100).optional().messages({
    "string.min": "Join token must be at least 10 characters long",
    "string.max": "Join token cannot exceed 100 characters",
  }),
});

// Individual invite validation for bulk invites
const inviteItemValidation = Joi.object().pattern(
  // Email pattern as key
  Joi.string().email().required().messages({
    "string.email": "Each key must be a valid email address",
    "any.required": "Email is required",
  }),
  // Role as value
  Joi.string()
    .valid(
      ...Object.values(ROLES).filter(
        (role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION
      )
    )
    .required()
    .messages({
      "any.only": `Role must be one of: ${Object.values(ROLES)
        .filter((role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION)
        .join(", ")}`,
      "any.required": "Role is required for each email",
    })
);

// Send bulk invites validation schema
const sendBulkInvitesValidation = Joi.object({
  invites: inviteItemValidation.min(1).max(50).required().messages({
    "object.min": "At least one invite is required",
    "object.max": "Cannot send more than 50 invites at once",
    "any.required": "Invites object is required",
    "object.base": "Invites must be an object with email:role pairs",
  }),
});

// Create invite slot validation schema (for admin use)
const createInviteSlotValidation = Joi.object({
  companyId: helpers.objectIdValidation.required().messages({
    "any.required": "Company ID is required",
  }),

  slot: Joi.number().integer().min(1).required().messages({
    "number.min": "Slot number must be at least 1",
    "number.integer": "Slot must be an integer",
    "any.required": "Slot number is required",
  }),

  token: Joi.string().trim().min(20).max(100).optional().messages({
    "string.min": "Token must be at least 20 characters long",
    "string.max": "Token cannot exceed 100 characters",
  }),
});

// Update invite slot validation schema
const updateInviteSlotValidation = Joi.object({
  used: Joi.boolean().optional().messages({
    "boolean.base": "Used must be a boolean value",
  }),

  reserved: Joi.boolean().optional().messages({
    "boolean.base": "Reserved must be a boolean value",
  }),

  reservedFor: Joi.string().email().optional().messages({
    "string.email": "Reserved for must be a valid email address",
  }),

  reservedRole: Joi.string()
    .valid(
      ...Object.values(ROLES).filter(
        (role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION
      )
    )
    .optional()
    .messages({
      "any.only": `Reserved role must be one of: ${Object.values(ROLES)
        .filter((role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION)
        .join(", ")}`,
    }),

  reservedAt: Joi.date().optional().messages({
    "date.base": "Reserved at must be a valid date",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

// Invite slot ID parameter validation
const inviteSlotIdParamValidation = Joi.object({
  inviteSlotId: helpers.objectIdValidation.required().messages({
    "any.required": "Invite slot ID is required",
  }),
});

// Company ID parameter validation for invites
const companyIdParamValidation = Joi.object({
  companyId: helpers.objectIdValidation.required().messages({
    "any.required": "Company ID is required",
  }),
});

// Get invite slots query validation
const getInviteSlotsQueryValidation = Joi.object({
  companyId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Company ID must be a valid ObjectId",
  }),

  used: Joi.boolean().optional().messages({
    "boolean.base": "Used must be a boolean value",
  }),

  reserved: Joi.boolean().optional().messages({
    "boolean.base": "Reserved must be a boolean value",
  }),

  reservedFor: Joi.string().email().optional().messages({
    "string.email": "Reserved for must be a valid email address",
  }),

  reservedRole: Joi.string()
    .valid(
      ...Object.values(ROLES).filter(
        (role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION
      )
    )
    .optional()
    .messages({
      "any.only": `Reserved role must be one of: ${Object.values(ROLES)
        .filter((role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION)
        .join(", ")}`,
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
    .valid("slot", "createdAt", "reservedAt", "used", "reserved")
    .optional()
    .default("slot")
    .messages({
      "any.only":
        "Sort by must be one of: slot, createdAt, reservedAt, used, reserved",
    }),

  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("asc")
    .messages({
      "any.only": "Sort order must be either 'asc' or 'desc'",
    }),
});

// Revoke invite validation schema
const revokeInviteValidation = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Email must be a valid email address",
    "any.required": "Email is required",
  }),

  companyId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Company ID must be a valid ObjectId",
  }),
});

// Resend invite validation schema
const resendInviteValidation = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Email must be a valid email address",
    "any.required": "Email is required",
  }),

  role: Joi.string()
    .valid(
      ...Object.values(ROLES).filter(
        (role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION
      )
    )
    .optional()
    .messages({
      "any.only": `Role must be one of: ${Object.values(ROLES)
        .filter((role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION)
        .join(", ")}`,
    }),

  companyId: helpers.objectIdValidation.optional().messages({
    "string.pattern.base": "Company ID must be a valid ObjectId",
  }),
});

// Validate single email and role
const validateSingleInvite = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Email must be a valid email address",
    "any.required": "Email is required",
  }),

  role: Joi.string()
    .valid(
      ...Object.values(ROLES).filter(
        (role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION
      )
    )
    .required()
    .messages({
      "any.only": `Role must be one of: ${Object.values(ROLES)
        .filter((role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION)
        .join(", ")}`,
      "any.required": "Role is required",
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
  validateGetUnusedInviteSlotQuery: validateRequest(
    getUnusedInviteSlotQueryValidation,
    "query"
  ),
  validateSendBulkInvites: validateRequest(sendBulkInvitesValidation),
  validateCreateInviteSlot: validateRequest(createInviteSlotValidation),
  validateUpdateInviteSlot: validateRequest(updateInviteSlotValidation),
  validateInviteSlotIdParam: validateRequest(
    inviteSlotIdParamValidation,
    "params"
  ),
  validateCompanyIdParam: validateRequest(companyIdParamValidation, "params"),
  validateGetInviteSlotsQuery: validateRequest(
    getInviteSlotsQueryValidation,
    "query"
  ),
  validateRevokeInvite: validateRequest(revokeInviteValidation),
  validateResendInvite: validateRequest(resendInviteValidation),
  validateSingleInvite: validateRequest(validateSingleInvite),

  // Export allowed roles for invites
  ALLOWED_INVITE_ROLES: Object.values(ROLES).filter(
    (role) => role !== ROLES.USER && role !== ROLES.ORGANIZATION
  ),

  // Export schemas for testing or custom usage
  schemas: {
    getUnusedInviteSlotQueryValidation,
    sendBulkInvitesValidation,
    createInviteSlotValidation,
    updateInviteSlotValidation,
    inviteSlotIdParamValidation,
    companyIdParamValidation,
    getInviteSlotsQueryValidation,
    revokeInviteValidation,
    resendInviteValidation,
    validateSingleInvite,
    inviteItemValidation,
  },
};
