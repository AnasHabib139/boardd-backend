const Joi = require("joi");

const connectTrelloValidation = Joi.object({
  token: Joi.string().min(10).required().messages({
    "string.empty": "Trello token is required",
    "string.min": "Invalid Trello token",
    "any.required": "Trello token is required",
  }),
});

const importBoardValidation = Joi.object({
  boardId: Joi.string().min(1).required().messages({
    "string.empty": "Board ID is required",
    "any.required": "Board ID is required",
  }),
});

const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate =
      source === "params" ? req.params : source === "query" ? req.query : req.body;

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
        errors,
        statusCode: 400,
      });
    }

    if (source === "params") req.params = value;
    else if (source === "query") req.query = value;
    else req.body = value;

    next();
  };
};

module.exports = {
  validateConnectTrello: validateRequest(connectTrelloValidation),
  validateImportBoard: validateRequest(importBoardValidation),
};
