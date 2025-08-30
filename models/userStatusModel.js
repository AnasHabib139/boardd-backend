"use strict";

const { Schema, model, Types } = require("mongoose");

const userStatusSchema = new Schema({
  userId: {
    type: Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  statusType: {
    type: String,
    enum: ["meeting", "focusing", "sick", "vacation", "custom"],
    default: null,
  },
  statusMessage: {
    type: String,
    default: null,
  },
  statusEmoji: {
    type: String,
    default: null,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field before saving
userStatusSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

const UserStatusModel = model("UserStatus", userStatusSchema);

// Create or update user status (upsert)
exports.createOrUpdateUserStatus = (query, updateData) => 
  UserStatusModel.findOneAndUpdate(query, updateData, { 
    upsert: true, 
    new: true,
    setDefaultsOnInsert: true 
  });

// Find user status
exports.findUserStatus = (query) => 
  UserStatusModel.findOne(query);

// Find all expired statuses for cron job
exports.findExpiredStatuses = () => 
  UserStatusModel.find({
    isActive: true,
    expiresAt: { $lte: new Date() }
  });

// Update user status
exports.updateUserStatus = (query, updateData) => 
  UserStatusModel.findOneAndUpdate(query, updateData, { new: true });

// Delete user status
exports.deleteUserStatus = (query) => 
  UserStatusModel.findOneAndDelete(query);