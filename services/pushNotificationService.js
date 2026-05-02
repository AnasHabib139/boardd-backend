"use strict";

const webpush = require("web-push");
const { findSubscriptionsByUser, deletePushSubscription } = require("../models/pushSubscriptionModel");
const { findUserMutePreferences } = require("../models/userMutePreferencesModel");

webpush.setVapidDetails(
  "mailto:support@boarddd.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.isUserMuted = async (userId, channelId = null) => {
  const mutePrefs = await findUserMutePreferences({ userId });
  const now = new Date();

  if (mutePrefs?.isMuted && mutePrefs.muteUntil > now) return true;

  if (channelId && mutePrefs?.channelMutes?.length) {
    const entry = mutePrefs.channelMutes.find(
      (m) => m.channelId.toString() === channelId.toString()
    );
    if (entry?.muteUntil && entry.muteUntil > now) return true;
  }

  return false;
};

exports.sendPushToUser = async (userId, payload) => {
  const subscriptions = await findSubscriptionsByUser(userId);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await deletePushSubscription({ endpoint: sub.endpoint });
        }
      }
    })
  );
};

exports.sendPushIfNotMuted = async (userId, payload, channelId = null) => {
  if (await exports.isUserMuted(userId, channelId)) return;
  await exports.sendPushToUser(userId, payload);
};
