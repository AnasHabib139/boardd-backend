"use strict";

const { Schema, model } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const { getMongoosePaginatedData } = require("../utils");

const SuperAdminAuditLogSchema = new Schema(
  {
    superAdminId: {
      type: Schema.Types.ObjectId,
      ref: "SuperAdmin",
      required: true,
    },
    action: {
      type: String,
      enum: ["company_disabled", "company_enabled"],
      required: true,
    },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    reason: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

SuperAdminAuditLogSchema.plugin(mongoosePaginate);

const SuperAdminAuditLogModel = model(
  "SuperAdminAuditLog",
  SuperAdminAuditLogSchema
);

exports.createSuperAdminAuditLog = (obj) =>
  SuperAdminAuditLogModel.create(obj);

exports.getCompanyAuditLog = async ({ companyId, page, limit }) => {
  const { data, pagination } = await getMongoosePaginatedData({
    model: SuperAdminAuditLogModel,
    query: { companyId },
    page,
    limit,
    select: "",
  });
  return { data, pagination };
};
