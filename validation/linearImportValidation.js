"use strict";

const Joi = require("joi");

const connectLinearValidation = Joi.object({
  code: Joi.string().min(1).required().messages({
    "string.empty": "Authorization code is required",
    "any.required": "Authorization code is required",
  }),
});

const importLinearValidation = Joi.object({
  teamIds: Joi.array().items(Joi.string().min(1)).min(1).required().messages({
    "array.base":   "teamIds must be an array",
    "array.min":    "At least one team ID is required",
    "any.required": "teamIds is required",
  }),
  channelId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().messages({
    "string.pattern.base": "channelId must be a valid MongoDB ObjectId",
  }),
  channelName: Joi.string().trim().min(1).optional().messages({
    "string.min": "Channel name cannot be empty",
  }),
});

const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate =
      source === "params" ? req.params : source === "query" ? req.query : req.body;

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly:   false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field:   detail.path.join("."),
        message: detail.message,
        value:   detail.context.value,
      }));
      return res.status(400).json({
        success:    false,
        message:    "Validation failed",
        errors,
        statusCode: 400,
      });
    }

    if (source === "params") req.params = value;
    else if (source === "query") {
      const q = req.query;
      Object.keys(q).forEach((k) => { if (!(k in value)) delete q[k]; });
      Object.assign(q, value);
    } else req.body = value;

    next();
  };
};

module.exports = {
  validateConnectLinear: validateRequest(connectLinearValidation),
  validateImportLinear:  validateRequest(importLinearValidation),
};
