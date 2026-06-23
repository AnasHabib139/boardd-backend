"use strict";

const Joi = require("joi");

const connectNotionValidation = Joi.object({
  code: Joi.string().min(1).required().messages({
    "string.empty": "Authorization code is required",
    "any.required": "Authorization code is required",
  }),
});

const importNotionValidation = Joi.object({
  databaseIds: Joi.array().items(Joi.string().min(1)).min(0).default([]).messages({
    "array.base": "databaseIds must be an array",
  }),
  pageIds: Joi.array().items(Joi.string().min(1)).min(0).default([]).messages({
    "array.base": "pageIds must be an array",
  }),
  notionPagesName: Joi.string().trim().min(1).optional().messages({
    "string.min": "Notion pages name cannot be empty",
  }),
  channelId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().messages({
    "string.pattern.base": "channelId must be a valid MongoDB ObjectId",
  }),
  channelName: Joi.string().trim().min(1).optional().messages({
    "string.min": "Channel name cannot be empty",
  }),
}).custom((value, helpers) => {
  if (value.databaseIds.length === 0 && value.pageIds.length === 0) {
    return helpers.error("any.invalid");
  }
  return value;
}).messages({
  "any.invalid": "Select at least one database or page to import",
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

exports.validateConnectNotion = validateRequest(connectNotionValidation, "body");
exports.validateImportNotion = validateRequest(importNotionValidation, "body");
