"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { v4: uuidv4 } = require("uuid");

// Form invitation tracking schema (simplified)
const formInviteSchema = new Schema({
  formId: { type: Types.ObjectId, ref: "Form", required: true },
  invitedBy: { type: Types.ObjectId, ref: "User", required: true },
  invitedEmail: { type: String, required: true, lowercase: true },
  invitedName: { type: String, required: true }, // Name of the person invited
  inviteToken: { type: String, default: uuidv4 }, // Unique token for tracking

  // Email tracking (simplified)
  emailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date },

  // Response tracking
  hasResponded: { type: Boolean, default: false },
  respondedAt: { type: Date },
  responseId: { type: Types.ObjectId, ref: "FormResponse" }, // Link to actual response

  // Invitation settings
  customMessage: { type: String, maxlength: 500 },
  shareMethod: {
    type: String,
    enum: ["email", "link", "anonymous"],
    default: "email",
  },

  // Status tracking (simplified)
  status: {
    type: String,
    enum: ["pending", "responded"],
    default: "pending",
  },
  isActive: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for performance
formInviteSchema.index({ formId: 1 });
formInviteSchema.index({ invitedEmail: 1 });
formInviteSchema.index({ inviteToken: 1 }, { unique: true });
formInviteSchema.index({ invitedBy: 1 });
formInviteSchema.index({ status: 1 });
formInviteSchema.index({ createdAt: -1 });

// Compound indexes
formInviteSchema.index({ formId: 1, invitedEmail: 1 });
formInviteSchema.index({ formId: 1, status: 1 });

// Pre-save middleware to update timestamps
formInviteSchema.pre("save", function (next) {
  this.updatedAt = new Date();

  // Update status based on response
  if (this.hasResponded && this.status !== "responded") {
    this.status = "responded";
    if (!this.respondedAt) {
      this.respondedAt = new Date();
    }
  }

  next();
});

// Register pagination plugins
formInviteSchema.plugin(mongoosePaginate);
formInviteSchema.plugin(aggregatePaginate);

const FormInviteModel = model("FormInvite", formInviteSchema);

// CRUD operations
exports.createFormInvite = (obj) => FormInviteModel.create(obj);

exports.findFormInvite = (query) => FormInviteModel.findOne(query);

exports.findManyFormInvites = (query, options = {}) =>
  FormInviteModel.find(query, null, options);

exports.updateFormInvite = (query, update, options = {}) =>
  FormInviteModel.findOneAndUpdate(query, update, { new: true, ...options });

exports.deleteFormInvite = (query) => FormInviteModel.findOneAndDelete(query);

// Helper functions
exports.findInvitesByForm = (formId, options = {}) =>
  FormInviteModel.find({ formId, isActive: true }, null, options)
    .populate("invitedBy", "name email")
    .populate("responseId")
    .sort({ createdAt: -1 });

exports.findInviteByToken = (inviteToken) =>
  FormInviteModel.findOne({ inviteToken, isActive: true })
    .populate("formId")
    .populate("invitedBy", "name email");

exports.markAsResponded = async (inviteToken, responseId) => {
  return FormInviteModel.findOneAndUpdate(
    { inviteToken, isActive: true },
    {
      hasResponded: true,
      respondedAt: new Date(),
      responseId,
      status: "responded",
    },
    { new: true }
  );
};

// Analytics helpers
exports.getFormInviteStats = async (formId) => {
  const stats = await FormInviteModel.aggregate([
    { $match: { formId: new Types.ObjectId(formId), isActive: true } },
    {
      $group: {
        _id: null,
        totalInvites: { $sum: 1 },
        totalResponses: { $sum: { $cond: ["$hasResponded", 1, 0] } },
        pendingResponses: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalInvites: 1,
        totalResponses: 1,
        pendingResponses: 1,
        responseRate: {
          $cond: [
            { $eq: ["$totalInvites", 0] },
            0,
            {
              $multiply: [
                { $divide: ["$totalResponses", "$totalInvites"] },
                100,
              ],
            },
          ],
        },
      },
    },
  ]);

  return (
    stats[0] || {
      totalInvites: 0,
      totalResponses: 0,
      pendingResponses: 0,
      responseRate: 0,
    }
  );
};

// Get invitation list for dashboard (with response status)
exports.getFormInvitesForDashboard = async (formId) => {
  return FormInviteModel.find({ formId, isActive: true })
    .populate("invitedBy", "name email")
    .populate("responseId", "submittedAt")
    .sort({ createdAt: -1 })
    .select(
      "invitedName invitedEmail hasResponded respondedAt status createdAt customMessage shareMethod"
    );
};

// Export model for aggregations
exports.FormInviteModel = FormInviteModel;
