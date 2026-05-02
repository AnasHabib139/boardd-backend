"use strict";

const { Schema, model, Types } = require("mongoose");

const PushSubscriptionSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  { timestamps: true }
);

const PushSubscriptionModel = model("PushSubscription", PushSubscriptionSchema);

exports.PushSubscriptionModel = PushSubscriptionModel;

exports.upsertPushSubscription = ({ userId, endpoint, p256dh, auth }) =>
  PushSubscriptionModel.findOneAndUpdate(
    { endpoint },
    { userId, endpoint, p256dh, auth },
    { upsert: true, new: true }
  );

exports.deletePushSubscription = (query) =>
  PushSubscriptionModel.findOneAndDelete(query);

exports.findSubscriptionsByUser = (userId) =>
  PushSubscriptionModel.find({ userId });
