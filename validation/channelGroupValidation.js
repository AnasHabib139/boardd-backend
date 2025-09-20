const Joi = require("joi");

// Create channel group validation schema
const createChannelGroupValidation = Joi.object({
  title: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Title is required",
    "string.min": "Title must be at least 2 characters long",
    "string.max": "Title cannot exceed 100 characters",
  }),
});

// Assign channels to group validation schema
const assignChannelsToGroupValidation = Joi.object({
  channelIds: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().regex(/^[0-9a-fA-F]{24}$/)),
      Joi.allow(null)
    )
    .required()
    .messages({
      "alternatives.match": "Channel IDs must be an array of valid ObjectIds or null",
      "string.pattern.base": "Each channel ID must be a valid MongoDB ObjectId",
      "any.required": "Channel IDs field is required (can be empty array or null to empty the group)",
    }),
  channelGroupId: Joi.string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "Channel group ID must be a valid MongoDB ObjectId",
      "string.empty": "Channel group ID is required",
      "any.required": "Channel group ID is required",
    }),
});

// Validation middleware function
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
        errors: errors,
        statusCode: 400,
      });
    }

    // Replace the original data with validated data
    if (source === "query") {
      req.query = value;
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = {
  validateCreateChannelGroup: validateRequest(createChannelGroupValidation),
  validateAssignChannelsToGroup: validateRequest(assignChannelsToGroupValidation),

  // Export schemas for testing or custom usage
  schemas: {
    createChannelGroupValidation,
    assignChannelsToGroupValidation,
  },
};