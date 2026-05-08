const Joi = require("joi");
const { ROLES, CHANNEL_PREFERENCE } = require("../utils/constants");

// Signup validation schema
const signupValidation = Joi.object({
  name: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Name is required",
    "string.min": "Name must be at least 2 characters long",
    "string.max": "Name cannot exceed 50 characters",
  }),

  email: Joi.string().email().lowercase().trim().required().messages({
    "string.email": "Please provide a valid email address",
    "string.empty": "Email is required",
  }),

  password: Joi.string().min(8).max(30).required().messages({
    "string.min": "Password must be at least 8 characters long",
    "string.max": "Password cannot exceed 30 characters",
    "string.empty": "Password is required",
  }),

  accountName: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Organization name is required",
    "string.min": "Organization name must be at least 2 characters long",
    "string.max": "Organization name cannot exceed 100 characters",
  }),

  role: Joi.string()
    .valid(...Object.values(ROLES))
    .required()
    .messages({
      "any.only": `Role must be one of: ${Object.values(ROLES).join(", ")}`,
      "string.empty": "Role is required",
    }),

  howDidYouHearAboutUs: Joi.string().trim().max(200).optional().messages({
    "string.max": "How did you hear about us cannot exceed 200 characters",
  }),
});

// Login validation schemas
const loginValidation = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .when("$hasToken", {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      "string.empty": "Name is required for signup",
      "string.min": "Name must be at least 2 characters long",
      "string.max": "Name cannot exceed 50 characters",
    }),

  email: Joi.string().email().lowercase().trim().required().messages({
    "string.email": "Please provide a valid email address",
    "string.empty": "Email is required",
  }),

  password: Joi.string().min(6).max(30).required().messages({
    "string.min": "Password must be at least 6 characters long",
    "string.max": "Password cannot exceed 30 characters",
    "string.empty": "Password is required",
  }),
});

// Query validation for getUsersOfCompany
const getUsersQueryValidation = Joi.object({
  email: Joi.string().email().optional().messages({
    "string.email": "Please provide a valid email format for search",
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

// Validation middleware function
const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate = source === "query" ? req.query : req.body;

    // Add context for conditional validations
    const context = {
      hasToken: !!(req.query.token || req.query.joinToken),
    };

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      context,
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
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = {
  validateSignup: validateRequest(signupValidation),
  validateLogin: validateRequest(loginValidation),
  validateGetUsersQuery: validateRequest(getUsersQueryValidation, "query"),

  // Export schemas for testing or custom usage
  schemas: {
    signupValidation,
    loginValidation,
    getUsersQueryValidation,
  },
};
