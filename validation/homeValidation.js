"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");

// Recently viewed query validation
const getRecentlyViewedQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
}).unknown(false);

// Validation middleware
const validateGetRecentlyViewed = (req, res, next) => {
  const { error, value } = getRecentlyViewedQuerySchema.validate(req.query);

  if (error) {
    return res.status(STATUS_CODES.BAD_REQUEST).json({
      message: "Query validation error",
      errors: error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      })),
    });
  }

  Object.assign(req.query, value);
  next();
};

module.exports = {
  validateGetRecentlyViewed,
};