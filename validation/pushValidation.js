"use strict";

const Joi = require("joi");

const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate =
      source === "params" ? req.params : source === "query" ? req.query : req.body;

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
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

const subscribeSchema = Joi.object({
  subscription: Joi.object({
    endpoint: Joi.string().uri().required().messages({
      "string.uri": "endpoint must be a valid URI",
      "any.required": "endpoint is required",
    }),
    keys: Joi.object({
      p256dh: Joi.string().required().messages({
        "any.required": "p256dh key is required",
      }),
      auth: Joi.string().required().messages({
        "any.required": "auth key is required",
      }),
    }).required(),
  }).required(),
});

const unsubscribeSchema = Joi.object({
  endpoint: Joi.string().uri().required().messages({
    "string.uri": "endpoint must be a valid URI",
    "any.required": "endpoint is required",
  }),
});

module.exports = {
  validateSubscribe: validateRequest(subscribeSchema),
  validateUnsubscribe: validateRequest(unsubscribeSchema),
};
