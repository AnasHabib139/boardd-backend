"use strict";

const { Schema, model, Types } = require("mongoose");

const formFavoriteSchema = new Schema({
  userId: { type: Types.ObjectId, ref: "User", required: true },
  formId: { type: Types.ObjectId, ref: "Form", required: true },
  createdAt: { type: Date, default: Date.now },
});

// A user can favorite a form only once
formFavoriteSchema.index({ userId: 1, formId: 1 }, { unique: true });

const FormFavoriteModel = model("FormFavorite", formFavoriteSchema);

// Create a favorite (idempotent at controller level)
exports.createFormFavorite = (obj) => FormFavoriteModel.create(obj);

// Remove a favorite
exports.deleteFormFavorite = (query) =>
  FormFavoriteModel.findOneAndDelete(query);

// Check if favorite exists
exports.findFormFavorite = (query) => FormFavoriteModel.findOne(query);

// Find many favorites
exports.findManyFormFavorites = (query) => FormFavoriteModel.find(query);

// Aggregate helper for pagination if needed later
exports.FormFavoriteModel = FormFavoriteModel;
