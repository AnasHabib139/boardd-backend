const Joi = require("joi");

// Validation for get contributions endpoint
exports.validateGetContributions = (req, res, next) => {
  const schema = Joi.object({
    channelId: Joi.string().required().length(24).hex(),
  });

  const querySchema = Joi.object({
    duration: Joi.string()
      .valid(
        "current_month",
        "3months",
        "4months",
        "6months",
        "8months",
        "9months",
        "12months"
      )
      .default("current_month"),
  });

  const { error: paramsError } = schema.validate(req.params);
  if (paramsError) {
    return res.status(400).json({
      success: false,
      message: "Invalid parameters",
      errors: paramsError.details.map((detail) => detail.message),
    });
  }

  const { error: queryError } = querySchema.validate(req.query);
  if (queryError) {
    return res.status(400).json({
      success: false,
      message: "Invalid query parameters",
      errors: queryError.details.map((detail) => detail.message),
    });
  }

  next();
};

// Validation for mark all tasks as completed endpoint
exports.validateMarkAllComplete = (req, res, next) => {
  const schema = Joi.object({
    channelId: Joi.string().required().length(24).hex(),
  });

  const { error } = schema.validate(req.params);
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid parameters",
      errors: error.details.map((detail) => detail.message),
    });
  }

  next();
};

// Validation for get activities endpoint
exports.validateGetActivities = (req, res, next) => {
  const schema = Joi.object({
    channelId: Joi.string().required().length(24).hex(),
  });

  const querySchema = Joi.object({
    duration: Joi.string()
      .valid(
        "current_month",
        "3months",
        "4months",
        "6months",
        "8months",
        "9months",
        "12months"
      )
      .default("current_month"),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  });

  const { error: paramsError } = schema.validate(req.params);
  if (paramsError) {
    return res.status(400).json({
      success: false,
      message: "Invalid parameters",
      errors: paramsError.details.map((detail) => detail.message),
    });
  }

  const { error: queryError } = querySchema.validate(req.query);
  if (queryError) {
    return res.status(400).json({
      success: false,
      message: "Invalid query parameters",
      errors: queryError.details.map((detail) => detail.message),
    });
  }

  next();
};

// Validation for mark all tasks as completed endpoint
exports.validateMarkAllComplete = (req, res, next) => {
  const schema = Joi.object({
    channelId: Joi.string().required().length(24).hex(),
  });

  const { error } = schema.validate(req.params);
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid parameters",
      errors: error.details.map((detail) => detail.message),
    });
  }

  next();
};
