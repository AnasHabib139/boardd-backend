"use strict";

const Joi = require("joi");
const { STATUS_CODES } = require("../utils/constants");

// Validation for creating team card
const createTeamCardSchema = Joi.object({
  title: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      "string.min": "Title must be at least 1 character long",
      "string.max": "Title cannot exceed 100 characters",
      "any.required": "Title is required",
    }),
});

// Validation for adding member to team card
const addTeamCardMemberSchema = Joi.object({
  category: Joi.string()
    .max(100)
    .required()
    .messages({
      "string.max": "Category cannot exceed 100 characters",
      "any.required": "Category is required",
    }),
  memberName: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      "string.min": "Member name must be at least 1 character",
      "string.max": "Member name cannot exceed 100 characters",
      "any.required": "Member name is required",
    }),
  memberEmail: Joi.string()
    .email()
    .required()
    .messages({
      "string.email": "Member email must be a valid email address",
      "any.required": "Member email is required",
    }),
  designation: Joi.string()
    .max(100)
    .optional()
    .allow("")
    .messages({
      "string.max": "Designation cannot exceed 100 characters",
    }),
});

// Validation for removing member from team card
const removeTeamCardMemberSchema = Joi.object({
  memberId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "memberId must be a valid MongoDB ObjectId",
      "any.required": "memberId is required",
    }),
});

// Validation for editing member in team card
const editTeamCardMemberSchema = Joi.object({
  category: Joi.string()
    .max(100)
    .optional()
    .messages({
      "string.max": "Category cannot exceed 100 characters",
    }),
  memberName: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .messages({
      "string.min": "Member name must be at least 1 character",
      "string.max": "Member name cannot exceed 100 characters",
    }),
  designation: Joi.string()
    .max(100)
    .optional()
    .allow("")
    .messages({
      "string.max": "Designation cannot exceed 100 characters",
    }),
}).min(1).messages({
  "object.min": "At least one field must be provided for update",
});

// Validation for editing team card
const editTeamCardSchema = Joi.object({
  title: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .messages({
      "string.min": "Title must be at least 1 character long",
      "string.max": "Title cannot exceed 100 characters",
    }),
  isActive: Joi.boolean()
    .optional()
    .messages({
      "boolean.base": "isActive must be a boolean value",
    }),
}).min(1).messages({
  "object.min": "At least one field must be provided for update",
});

// Validation for team card ID parameter
const teamCardIdParamSchema = Joi.object({
  cardId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "cardId must be a valid MongoDB ObjectId",
      "any.required": "cardId is required",
    }),
});

// Validation for team card ID and member ID parameters
const teamCardMemberIdParamSchema = Joi.object({
  cardId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "cardId must be a valid MongoDB ObjectId",
      "any.required": "cardId is required",
    }),
  memberId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "memberId must be a valid MongoDB ObjectId",
      "any.required": "memberId is required",
    }),
});

// Middleware to validate create team card request
exports.validateCreateTeamCard = (req, res, next) => {
  const { error } = createTeamCardSchema.validate(req.body);
  if (error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: error.details[0].message,
    });
  }
  next();
};

// Middleware to validate add team card member request
exports.validateAddTeamCardMember = (req, res, next) => {
  const { error } = addTeamCardMemberSchema.validate(req.body);
  if (error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: error.details[0].message,
    });
  }
  next();
};

// Middleware to validate remove team card member request
exports.validateRemoveTeamCardMember = (req, res, next) => {
  const { error } = removeTeamCardMemberSchema.validate(req.body);
  if (error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: error.details[0].message,
    });
  }
  next();
};

// Middleware to validate edit team card member request
exports.validateEditTeamCardMember = (req, res, next) => {
  const { error } = editTeamCardMemberSchema.validate(req.body);
  if (error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: error.details[0].message,
    });
  }
  next();
};

// Middleware to validate team card ID and member ID parameters
exports.validateTeamCardMemberIdParams = (req, res, next) => {
  const { error } = teamCardMemberIdParamSchema.validate(req.params);
  if (error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: error.details[0].message,
    });
  }
  next();
};

// Validation for member profile query parameters
const memberProfileQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(20),
  filter: Joi.string().valid('all', 'ongoing', 'completed').optional().default('all').messages({
    "any.only": "Filter must be 'all', 'ongoing', or 'completed'",
  }),
});

// Validation for member ID parameter
const memberIdParamSchema = Joi.object({
  memberId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "memberId must be a valid MongoDB ObjectId",
      "any.required": "memberId is required",
    }),
});

// Middleware to validate team card ID parameter
exports.validateTeamCardIdParam = (req, res, next) => {
  const { error } = teamCardIdParamSchema.validate(req.params);
  if (error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: error.details[0].message,
    });
  }
  next();
};

// Middleware to validate edit team card request
exports.validateEditTeamCard = (req, res, next) => {
  const { error } = editTeamCardSchema.validate(req.body);
  if (error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: error.details[0].message,
    });
  }
  next();
};

// Middleware to validate member profile request
exports.validateMemberProfile = (req, res, next) => {
  // Validate params
  const paramError = memberIdParamSchema.validate(req.params);
  if (paramError.error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: paramError.error.details[0].message,
    });
  }

  // Validate query parameters
  const queryError = memberProfileQuerySchema.validate(req.query);
  if (queryError.error) {
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: queryError.error.details[0].message,
    });
  }

  next();
};