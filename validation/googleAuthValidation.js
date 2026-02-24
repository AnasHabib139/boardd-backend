"use strict";

const Joi = require("joi");

const googleAuthSchema = Joi.object({
  idToken: Joi.string().required().messages({
    "string.empty": "Google ID token is required",
    "any.required": "Google ID token is required",
  }),

  accountName: Joi.string().trim().min(2).max(100).optional().messages({
    "string.min": "Organization name must be at least 2 characters long",
    "string.max": "Organization name cannot exceed 100 characters",
  }),

  howDidYouHearAboutUs: Joi.string().trim().max(200).optional().messages({
    "string.max": "How did you hear about us cannot exceed 200 characters",
  }),
});

const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate = source === "query" ? req.query : req.body;

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
        errors,
        statusCode: 400,
      });
    }

    req.body = value;
    next();
  };
};

module.exports = {
  validateGoogleAuth: validateRequest(googleAuthSchema),

  schemas: {
    googleAuthSchema,
  },
};
