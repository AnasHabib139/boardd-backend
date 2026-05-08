const Joi = require("joi");

// Mute notifications validation schema
const muteNotificationsValidation = Joi.object({
  duration: Joi.string()
    .valid("30min", "1hour", "2hours", "4hours", "8hours", "24hours", "168hours")
    .required()
    .messages({
      "any.only": "Duration must be one of: 30min, 1hour, 2hours, 4hours, 8hours, 24hours, 168hours",
      "any.required": "Duration is required",
    }),
});

// Validation middleware function
const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate =
      source === "query"
        ? req.query
        : source === "params"
        ? req.params
        : req.body;

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
        errors: errors,
        statusCode: 400,
      });
    }

    // Replace the original data with validated data
    if (source === "query") {
      const q = req.query;
      Object.keys(q).forEach((k) => { if (!(k in value)) delete q[k]; });
      Object.assign(q, value);
    } else if (source === "params") {
      req.params = value;
    } else {
      req.body = value;
    }

    next();
  };
};

// Per-channel mute body validation (duration is optional — omit for indefinite mute)
const muteChannelValidation = Joi.object({
  duration: Joi.string()
    .valid("30min", "1hour", "2hours", "4hours", "8hours", "24hours", "168hours")
    .optional(),
});

// Channel ID param validation
const channelIdParamValidation = Joi.object({
  channelId: Joi.string().hex().length(24).required().messages({
    "string.hex": "channelId must be a valid ObjectId",
    "string.length": "channelId must be 24 characters",
    "any.required": "channelId is required",
  }),
});

module.exports = {
  validateMuteNotifications: validateRequest(muteNotificationsValidation),
  validateMuteChannel: validateRequest(muteChannelValidation, "body"),
  validateChannelIdParam: validateRequest(channelIdParamValidation, "params"),

  // Export schemas for testing or custom usage
  schemas: {
    muteNotificationsValidation,
    muteChannelValidation,
    channelIdParamValidation,
  },
};