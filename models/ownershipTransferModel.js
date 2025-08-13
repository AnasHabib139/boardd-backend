"use strict";

const { Schema, model, Types } = require("mongoose");

const ownershipTransferSchema = new Schema({
  token: { type: String, required: true, unique: true, index: true },
  companyId: { type: Types.ObjectId, ref: "Company", required: true },
  currentOwnerId: { type: Types.ObjectId, ref: "User", required: true },
  newOwnerId: { type: Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
  usedAt: { type: Date },
});

ownershipTransferSchema.index({ expiresAt: 1 });

const OwnershipTransfer = model("OwnershipTransfer", ownershipTransferSchema);

exports.createOwnershipTransfer = (obj) => OwnershipTransfer.create(obj);

exports.findOwnershipTransferByToken = (token) =>
  OwnershipTransfer.findOne({ token });

exports.markOwnershipTransferUsed = (token) =>
  OwnershipTransfer.findOneAndUpdate(
    { token },
    { used: true, usedAt: new Date() },
    { new: true }
  );
