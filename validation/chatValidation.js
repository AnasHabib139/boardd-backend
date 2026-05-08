"use strict";

const Joi = require("joi");
const { helpers } = require("./authValidation");

const updateTwilioNumberBody = Joi.object({
  twilioNumber: Joi.string()
    .trim()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      "string.pattern.base": "twilioNumber must be in E.164 format (e.g., +15551234567)",
      "any.required": "twilioNumber is required",
    }),
});

const conversationIdParam = Joi.object({
  conversationId: helpers.objectIdValidation.required(),
});

const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const data =
      source === "params" ? req.params : source === "query" ? req.query : req.body;
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((d) => ({
          field: d.path.join("."),
          message: d.message,
          value: d.context.value,
        })),
        statusCode: 400,
      });
    }
    if (source === "params") req.params = value;
    else if (source === "query") req.query = value;
    else req.body = value;
    next();
  };
};

// --- message-dates query: ?year=2025&month=5 ---
const messageDatesQuerySchema = Joi.object({
  year: Joi.number()
    .integer()
    .min(2000)
    .max(2100)
    .required()
    .messages({
      "any.required": "year is required",
      "number.min": "year must be 2000 or later",
      "number.max": "year must be 2100 or earlier",
    }),
  month: Joi.number()
    .integer()
    .min(1)
    .max(12)
    .required()
    .messages({
      "any.required": "month is required",
      "number.min": "month must be between 1 and 12",
      "number.max": "month must be between 1 and 12",
    }),
});

module.exports = {
  validateUpdateTwilioNumber: validateRequest(updateTwilioNumberBody, "body"),
  validateConversationIdParam: validateRequest(conversationIdParam, "params"),
  validateMessageDatesQuery: validateRequest(messageDatesQuerySchema, "query"),
};
