"use strict";

const { generateResponse, parseBody } = require("../utils");
const { upsertPushSubscription, deletePushSubscription } = require("../models/pushSubscriptionModel");

exports.subscribe = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { subscription } = parseBody(req.body);
    const { endpoint, keys: { p256dh, auth } } = subscription;

    await upsertPushSubscription({ userId, endpoint, p256dh, auth });

    return generateResponse({ success: true }, "Subscribed successfully", res);
  } catch (error) {
    return next(error);
  }
};

exports.unsubscribe = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { endpoint } = parseBody(req.body);

    await deletePushSubscription({ userId, endpoint });

    return generateResponse({ success: true }, "Unsubscribed successfully", res);
  } catch (error) {
    return next(error);
  }
};
