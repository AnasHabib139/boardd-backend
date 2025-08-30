const Joi = require("joi");

// Set user status validation schema
const setUserStatusValidation = Joi.object({
  statusType: Joi.string()
    .valid("meeting", "focusing", "sick", "vacation", "custom")
    .required()
    .messages({
      "any.only": "Status type must be one of: meeting, focusing, sick, vacation, custom",
      "any.required": "Status type is required",
    }),
  customMessage: Joi.string()
    .max(100)
    .when("statusType", {
      is: "custom",
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      "string.max": "Custom message cannot exceed 100 characters",
      "any.required": "Custom message is required when status type is custom",
    }),
  statusEmoji: Joi.string()
    .max(10)
    .optional()
    .messages({
      "string.max": "Emoji cannot exceed 10 characters",
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
      req.query = value;
    } else if (source === "params") {
      req.params = value;
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = {
  validateSetUserStatus: validateRequest(setUserStatusValidation),
  
  // Export schemas for testing or custom usage
  schemas: {
    setUserStatusValidation,
  },
};