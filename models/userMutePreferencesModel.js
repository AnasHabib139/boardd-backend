"use strict";

const { Schema, model, Types } = require("mongoose");

const userMutePreferencesSchema = new Schema({
  userId: {
    type: Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  isMuted: {
    type: Boolean,
    default: false,
  },
  muteDuration: {
    type: String,
    enum: ["30min", "1hour", "2hours", "4hours", "8hours"],
  },
  muteUntil: {
    type: Date,
  },
  mutedChannels: [
    {
      type: Types.ObjectId,
      ref: "Channel",
    },
  ],
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
userMutePreferencesSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

const UserMutePreferencesModel = model("UserMutePreferences", userMutePreferencesSchema);

// Create or update user mute preferences
exports.createOrUpdateMutePreferences = (query, updateData) => 
  UserMutePreferencesModel.findOneAndUpdate(query, updateData, { 
    upsert: true, 
    new: true,
    setDefaultsOnInsert: true 
  });

// Find user mute preferences
exports.findUserMutePreferences = (query) => 
  UserMutePreferencesModel.findOne(query);

// Find all expired mute preferences for cron job
exports.findExpiredMutePreferences = () => 
  UserMutePreferencesModel.find({
    isMuted: true,
    muteUntil: { $lte: new Date() }
  });

// Update user mute preferences
exports.updateUserMutePreferences = (query, updateData) => 
  UserMutePreferencesModel.findOneAndUpdate(query, updateData, { new: true });

// Delete user mute preferences
exports.deleteUserMutePreferences = (query) => 
  UserMutePreferencesModel.findOneAndDelete(query);