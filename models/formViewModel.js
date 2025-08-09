"use strict";

const { Schema, model, Types } = require("mongoose");

const formViewSchema = new Schema({
  userId: { type: Types.ObjectId, ref: "User", required: true },
  formId: { type: Types.ObjectId, ref: "Form", required: true },
  lastViewedAt: { type: Date, default: Date.now },
});

// Unique per user per form
formViewSchema.index({ userId: 1, formId: 1 }, { unique: true });
formViewSchema.index({ lastViewedAt: -1 });

const FormViewModel = model("FormView", formViewSchema);

// Upsert last viewed timestamp for a (user, form)
exports.upsertFormView = async ({ userId, formId, when = new Date() }) => {
  const castUserId =
    typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  const castFormId =
    typeof formId === "string" ? new Types.ObjectId(formId) : formId;

  // Use updateOne with upsert for a guaranteed insert on first view
  const result = await FormViewModel.updateOne(
    { userId: castUserId, formId: castFormId },
    {
      $set: { lastViewedAt: when },
      $setOnInsert: { userId: castUserId, formId: castFormId },
    },
    { upsert: true }
  );

  return result;
};

exports.findFormView = (query) => FormViewModel.findOne(query);
exports.findManyFormViews = (query) => FormViewModel.find(query);
exports.FormViewModel = FormViewModel;
