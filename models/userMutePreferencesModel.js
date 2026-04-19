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
    enum: ["30min", "1hour", "2hours", "4hours", "8hours", "24hours", "168hours"],
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
  // Per-channel mutes (independent of global mute)
  channelMutes: [
    {
      channelId: { type: Types.ObjectId, ref: "Channel", required: true },
      mutedAt: { type: Date, default: Date.now },
      muteUntil: { type: Date, default: null }, // null = indefinitely muted
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

// Find all expired global mute preferences for cron job
exports.findExpiredMutePreferences = () =>
  UserMutePreferencesModel.find({
    isMuted: true,
    muteUntil: { $lte: new Date() }
  });

// Find all docs that have at least one expired timed channel mute
exports.findExpiredChannelMutes = () =>
  UserMutePreferencesModel.find({
    channelMutes: {
      $elemMatch: {
        muteUntil: { $ne: null, $lte: new Date() },
      },
    },
  });

// Update user mute preferences
exports.updateUserMutePreferences = (query, updateData) => 
  UserMutePreferencesModel.findOneAndUpdate(query, updateData, { new: true });

// Delete user mute preferences
exports.deleteUserMutePreferences = (query) =>
  UserMutePreferencesModel.findOneAndDelete(query);

// Add or update a per-channel mute entry
exports.upsertChannelMute = async (userId, channelId, muteUntil) => {
  const userObjectId = Types.ObjectId.createFromHexString(userId.toString());
  const channelObjectId = Types.ObjectId.createFromHexString(channelId.toString());

  // Try to update existing entry first
  const updated = await UserMutePreferencesModel.findOneAndUpdate(
    { userId: userObjectId, "channelMutes.channelId": channelObjectId },
    {
      $set: {
        "channelMutes.$.muteUntil": muteUntil,
        "channelMutes.$.mutedAt": new Date(),
        updatedAt: new Date(),
      },
    },
    { new: true }
  );

  if (updated) return updated;

  // Entry didn't exist — push new one (upsert the parent doc if needed)
  return UserMutePreferencesModel.findOneAndUpdate(
    { userId: userObjectId },
    {
      $push: { channelMutes: { channelId: channelObjectId, muteUntil, mutedAt: new Date() } },
      $set: { updatedAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

// Remove a per-channel mute entry
exports.removeChannelMute = (userId, channelId) => {
  const userObjectId = Types.ObjectId.createFromHexString(userId.toString());
  const channelObjectId = Types.ObjectId.createFromHexString(channelId.toString());

  return UserMutePreferencesModel.findOneAndUpdate(
    { userId: userObjectId },
    {
      $pull: { channelMutes: { channelId: channelObjectId } },
      $set: { updatedAt: new Date() },
    },
    { new: true }
  );
};

// Get the mute entry for a specific channel
exports.findChannelMuteEntry = async (userId, channelId) => {
  const userObjectId = Types.ObjectId.createFromHexString(userId.toString());
  const channelObjectId = Types.ObjectId.createFromHexString(channelId.toString());

  const prefs = await UserMutePreferencesModel.findOne(
    { userId: userObjectId, "channelMutes.channelId": channelObjectId },
    { "channelMutes.$": 1 }
  );

  return prefs?.channelMutes?.[0] || null;
};