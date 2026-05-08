const Joi = require("joi");

const connectTrelloValidation = Joi.object({
  token: Joi.string().min(10).required().messages({
    "string.empty": "Trello token is required",
    "string.min": "Invalid Trello token",
    "any.required": "Trello token is required",
  }),
});

const importBoardValidation = Joi.object({
  boardIds: Joi.array().items(Joi.string().min(1)).min(1).required().messages({
    "array.base": "boardIds must be an array",
    "array.min": "At least one board ID is required",
    "any.required": "boardIds is required",
  }),
  channelId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().messages({
    "string.pattern.base": "channelId must be a valid MongoDB ObjectId",
  }),
  channelName: Joi.string().trim().min(1).optional().messages({
    "string.min": "Channel name cannot be empty",
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
    else if (source === "query") { const q = req.query; Object.keys(q).forEach((k) => { if (!(k in value)) delete q[k]; }); Object.assign(q, value); }
    else req.body = value;

    next();
  };
};

module.exports = {
  validateConnectTrello: validateRequest(connectTrelloValidation),
  validateImportBoard: validateRequest(importBoardValidation),
};
