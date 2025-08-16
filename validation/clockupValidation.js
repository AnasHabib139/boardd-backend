const Joi = require("joi");

// Start clock validation schema
const startClockValidation = Joi.object({
  title: Joi.string().trim().max(200).optional().allow("").messages({
    "string.max": "Title cannot exceed 200 characters",
  }),

  description: Joi.string().trim().max(1000).optional().allow("").messages({
    "string.max": "Description cannot exceed 1000 characters",
  }),

  startTime: Joi.date().required().messages({
    "any.required": "Start time is required",
    "date.base": "Start time must be a valid date",
  }),
});

// Stop clock validation schema
const stopClockValidation = Joi.object({
  endTime: Joi.date().required().messages({
    "any.required": "End time is required",
    "date.base": "End time must be a valid date",
  }),
});

// Edit time entry validation schema
const editTimeEntryValidation = Joi.object({
  title: Joi.string().trim().max(200).optional().allow("").messages({
    "string.max": "Title cannot exceed 200 characters",
  }),

  description: Joi.string().trim().max(1000).optional().allow("").messages({
    "string.max": "Description cannot exceed 1000 characters",
  }),

  startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().messages({
    "string.pattern.base": "Start time must be in HH:MM format (24-hour)",
  }),

  endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().messages({
    "string.pattern.base": "End time must be in HH:MM format (24-hour)",
  }),

  totalTime: Joi.string().pattern(/^([0-9]+):([0-5]?[0-9]):([0-5]?[0-9])$/).optional().messages({
    "string.pattern.base": "Total time must be in HH:MM:SS format",
  }),
}).min(1).messages({
  "object.min": "At least one field must be provided for update",
});

// Time entry ID parameter validation
const timeEntryIdParamValidation = Joi.object({
  entryId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required().messages({
    "any.required": "Entry ID is required",
    "string.pattern.base": "Invalid entry ID format",
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
  validateStartClock: validateRequest(startClockValidation),
  validateStopClock: validateRequest(stopClockValidation),
  validateEditTimeEntry: validateRequest(editTimeEntryValidation),
  validateTimeEntryIdParam: validateRequest(timeEntryIdParamValidation, "params"),

  // Export schemas for testing or custom usage
  schemas: {
    startClockValidation,
    stopClockValidation,
    editTimeEntryValidation,
    timeEntryIdParamValidation,
  },
};