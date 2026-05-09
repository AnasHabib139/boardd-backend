"use strict";

const { Schema, model, Types } = require("mongoose");

const userIntegrationSchema = new Schema({
  userId:           { type: Types.ObjectId, ref: "User", required: true, index: true },
  platform:         { type: String, enum: ["trello", "clickup"], required: true },
  accessToken:      { type: String, required: true },
  platformUserId:   { type: String },
  platformUserName: { type: String },
  isActive:         { type: Boolean, default: true },
  createdAt:        { type: Date, default: Date.now },
  updatedAt:        { type: Date, default: Date.now },
});

userIntegrationSchema.index({ userId: 1, platform: 1 }, { unique: true });

const UserIntegration = model("UserIntegration", userIntegrationSchema);

exports.createUserIntegration = (obj) => UserIntegration.create(obj);

exports.findUserIntegration = (query) => UserIntegration.findOne(query);

exports.updateUserIntegration = (query, update, options = {}) =>
  UserIntegration.findOneAndUpdate(query, { ...update, updatedAt: Date.now() }, { new: true, ...options });

exports.deleteUserIntegration = (query) => UserIntegration.findOneAndDelete(query);

exports.findManyUserIntegrations = (query) => UserIntegration.find(query);
