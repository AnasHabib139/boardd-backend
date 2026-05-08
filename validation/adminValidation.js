const Joi = require("joi");

// Validation for toggling user seat status
const toggleUserSeatValidation = Joi.object({
  userId: Joi.string().trim().required().messages({
    "string.empty": "User ID is required",
    "any.required": "User ID is required",
  }),
});

// Validation for initiating ownership transfer
const initiateOwnershipTransferValidation = Joi.object({
  newOwnerId: Joi.string().trim().required().messages({
    "string.empty": "New owner ID is required",
    "any.required": "New owner ID is required",
  }),
});

// Validation for confirming ownership transfer (public)
const confirmOwnershipTransferValidation = Joi.object({
  token: Joi.string().trim().required().messages({
    "string.empty": "Token is required",
    "any.required": "Token is required",
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
      const q = req.query;
      Object.keys(q).forEach((k) => { if (!(k in value)) delete q[k]; });
      Object.assign(q, value);
    } else {
      req.body = value;
    }

    next();
  };
};

module.exports = {
  validateToggleUserSeat: validateRequest(toggleUserSeatValidation),
  validateInitiateOwnershipTransfer: validateRequest(
    initiateOwnershipTransferValidation
  ),
  validateConfirmOwnershipTransfer: validateRequest(
    confirmOwnershipTransferValidation
  ),

  // Export schemas for testing or custom usage
  schemas: {
    toggleUserSeatValidation,
    initiateOwnershipTransferValidation,
    confirmOwnershipTransferValidation,
  },
};
