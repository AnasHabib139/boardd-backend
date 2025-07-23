"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");

// Form response schema
const formResponseSchema = new Schema({
  formId: { type: Types.ObjectId, ref: "Form", required: true },
  inviteToken: { type: String, required: true }, // Links to FormInvite
  
  // Response data
  responses: [{
    fieldName: { type: String, required: true },
    fieldType: { type: String, required: true },
    label: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true } // Can be string, number, array, etc.
  }],
  
  // Submission metadata
  submittedAt: { type: Date, default: Date.now },
  ipAddress: { type: String },
  userAgent: { type: String },
  
  // File attachments (if form has file fields)
  attachments: [{
    fieldName: { type: String },
    fileName: { type: String },
    filePath: { type: String },
    fileSize: { type: Number },
    mimeType: { type: String }
  }],
  
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for performance
formResponseSchema.index({ formId: 1 });
formResponseSchema.index({ inviteToken: 1 });
formResponseSchema.index({ submittedAt: -1 });
formResponseSchema.index({ formId: 1, submittedAt: -1 });

// Register pagination plugins
formResponseSchema.plugin(mongoosePaginate);
formResponseSchema.plugin(aggregatePaginate);

const FormResponseModel = model("FormResponse", formResponseSchema);

// CRUD operations
exports.createFormResponse = (obj) => FormResponseModel.create(obj);

exports.findFormResponse = (query) => FormResponseModel.findOne(query);

exports.findManyFormResponses = (query, options = {}) => 
  FormResponseModel.find(query, null, options);

exports.updateFormResponse = (query, update, options = {}) =>
  FormResponseModel.findOneAndUpdate(query, update, { new: true, ...options });

exports.deleteFormResponse = (query) => FormResponseModel.findOneAndDelete(query);

// Helper functions
exports.findResponsesByForm = (formId, options = {}) =>
  FormResponseModel.find({ formId, isActive: true }, null, options)
    .populate("formId", "title description")
    .sort({ submittedAt: -1 });

exports.findResponseByToken = (inviteToken) =>
  FormResponseModel.findOne({ inviteToken, isActive: true })
    .populate("formId");

exports.getFormResponseStats = async (formId) => {
  const stats = await FormResponseModel.aggregate([
    { $match: { formId: new Types.ObjectId(formId), isActive: true } },
    {
      $group: {
        _id: null,
        totalResponses: { $sum: 1 },
        firstResponse: { $min: "$submittedAt" },
        lastResponse: { $max: "$submittedAt" },
        avgResponseTime: { $avg: { $subtract: ["$submittedAt", "$createdAt"] } }
      }
    }
  ]);
  
  return stats[0] || {
    totalResponses: 0,
    firstResponse: null,
    lastResponse: null,
    avgResponseTime: 0
  };
};

// Export model for aggregations
exports.FormResponseModel = FormResponseModel;