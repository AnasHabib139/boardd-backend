const Joi = require("joi");

// Start clock validation schema
const startClockValidation = Joi.object({
  title: Joi.string().trim().max(200).optional().allow("").messages({
    "string.max": "Title cannot exceed 200 characters",
  }),

  description: Joi.string().trim().max(1000).optional().allow("").messages({
    "string.max": "Description cannot exceed 1000 characters",
  }),

  tags: Joi.array()
    .items(Joi.string().trim().max(50))
    .max(10)
    .optional()
    .default([])
    .messages({
      "array.max": "Cannot have more than 10 tags",
      "string.max": "Each tag cannot exceed 50 characters",
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

  tags: Joi.array()
    .items(Joi.string().trim().max(50))
    .max(10)
    .optional()
    .messages({
      "array.max": "Cannot have more than 10 tags",
      "string.max": "Each tag cannot exceed 50 characters",
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

// Clockup reports query validation schema
const clockupReportsQueryValidation = Joi.object({
  userId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional().messages({
    "string.pattern.base": "Invalid user ID format",
  }),

  startDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().messages({
    "string.pattern.base": "Start date must be in YYYY-MM-DD format",
  }),

  endDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().messages({
    "string.pattern.base": "End date must be in YYYY-MM-DD format",
  }),

  selectedEntries: Joi.array()
    .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .single()
    .max(100)
    .optional()
    .messages({
      "array.base": "Selected entries must be an array",
      "string.pattern.base": "Each entry ID must be a valid MongoDB ObjectId",
      "array.max": "Cannot select more than 100 entries",
    }),

  page: Joi.number().integer().min(1).default(1).messages({
    "number.base": "Page must be a number",
    "number.integer": "Page must be an integer",
    "number.min": "Page must be at least 1",
  }),

  limit: Joi.number().integer().min(1).max(100).default(10).messages({
    "number.base": "Limit must be a number",
    "number.integer": "Limit must be an integer",
    "number.min": "Limit must be at least 1",
    "number.max": "Limit cannot exceed 100",
  }),
})
  .xor("selectedEntries", "startDate")
  .and("startDate", "endDate")
  .messages({
    "object.xor": "Provide either selectedEntries OR date range (startDate and endDate)",
    "object.and": "Both startDate and endDate are required when using date range",
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

module.exports = {
  validateStartClock: validateRequest(startClockValidation),
  validateStopClock: validateRequest(stopClockValidation),
  validateEditTimeEntry: validateRequest(editTimeEntryValidation),
  validateTimeEntryIdParam: validateRequest(timeEntryIdParamValidation, "params"),
  validateClockupReportsQuery: validateRequest(clockupReportsQueryValidation, "query"),

  // Export schemas for testing or custom usage
  schemas: {
    startClockValidation,
    stopClockValidation,
    editTimeEntryValidation,
    timeEntryIdParamValidation,
    clockupReportsQueryValidation,
  },
};
