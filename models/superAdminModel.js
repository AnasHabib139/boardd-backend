"use strict";

const { Schema, model } = require("mongoose");

const SuperAdminSchema = new Schema(
  {
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const SuperAdminModel = model("SuperAdmin", SuperAdminSchema);

exports.createSuperAdmin = (obj) => SuperAdminModel.create(obj);

exports.findSuperAdmin = (query) => SuperAdminModel.findOne(query);

exports.findManySuperAdmins = (query) => SuperAdminModel.find(query);

exports.updateSuperAdmin = (query, obj) =>
  SuperAdminModel.findOneAndUpdate(query, obj, { new: true });
