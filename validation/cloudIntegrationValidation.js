"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");
const { CLOUD_PROVIDERS } = require("../models/cloudIntegrationModel");

/**
 * Validation middleware for browsing cloud files
 */
exports.validateBrowseFiles = async (req, res, next) => {
  try {
    const schema = Joi.object({
      // Google Drive specific
      folderId: Joi.string().optional().allow(""),
      pageToken: Joi.string().optional(),
      pageSize: Joi.number().integer().min(1).max(100).optional(),

      // Dropbox specific
      path: Joi.string().optional().allow(""),
      cursor: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.query);

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedQuery = value;
    next();
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};

/**
 * Validation middleware for getting file metadata
 */
exports.validateFileMetadata = async (req, res, next) => {
  try {
    const schema = Joi.object({
      provider: Joi.string()
        .valid(...Object.values(CLOUD_PROVIDERS))
        .required()
        .messages({
          "any.required": "Provider is required",
          "any.only": `Provider must be one of: ${Object.values(CLOUD_PROVIDERS).join(", ")}`,
        }),
      fileId: Joi.string().required().messages({
        "any.required": "File ID is required",
        "string.empty": "File ID cannot be empty",
      }),
    });

    const { error, value } = schema.validate(req.query);

    if (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: error.details[0].message,
      });
    }

    req.validatedQuery = value;
    next();
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error.message,
    });
  }
};
