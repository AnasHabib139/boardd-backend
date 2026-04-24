"use strict";

/**
 * Migration: 043_clear_stale_channel_mutes_retry
 *
 * Migration 042 had a bug: it used countDocuments to check for affected docs
 * first, and returned { success: true } early if count was 0. Because of how
 * MongoDB matches null in array subdocuments (BSON type nuance), countDocuments
 * returned 0 even though stale entries existed — so the $pull never ran.
 *
 * This migration fixes that by running the $pull unconditionally on ALL
 * usermutepreferences documents. The operation is a no-op for docs without
 * any null muteUntil entries, so it's safe to run even on clean data.
 */

const { model } = require("mongoose");

module.exports = {
  name: "043_clear_stale_channel_mutes_retry",
  version: "1.0.0",
  description:
    "Retry clearing indefinite channel mutes (muteUntil: null). " +
    "Migration 042 had a silent early-return bug that prevented the $pull from running.",

  async up() {
    try {
      console.log("Starting 043_clear_stale_channel_mutes_retry...");

      const UserMutePreferences = model("UserMutePreferences");

      // Pull all indefinite (muteUntil: null) channelMutes entries from every doc.
      // No early-return guard — run unconditionally so the bug from 042 can't repeat.
      const result = await UserMutePreferences.updateMany(
        {},
        {
          $pull: { channelMutes: { muteUntil: null } },
          $set: { updatedAt: new Date() },
        }
      );

      console.log(
        `043: updateMany completed. matchedCount=${result.matchedCount}, modifiedCount=${result.modifiedCount}`
      );

      console.log("Migration 043 completed successfully.");
      return {
        success: true,
        message: `Cleared indefinite channel mutes from ${result.modifiedCount} user documents.`,
      };
    } catch (error) {
      console.error("Migration 043 failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    console.log("043 down: no-op. Removed stale mute entries are not recoverable.");
    return { success: true, message: "No-op rollback." };
  },
};
