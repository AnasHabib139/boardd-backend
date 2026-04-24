"use strict";

/**
 * Migration: 045_nuke_stale_channel_mutes
 *
 * Why previous migrations (042-044) all failed:
 *   Stale channelMutes entries have muteUntil stored as BSON undefined (type 6),
 *   a deprecated type. Neither $pull (query semantics: null != undefined) nor
 *   $filter with $ne (aggregation semantics) reliably handled this type across
 *   all MongoDB versions.
 *
 * This migration uses a $type guard: keep ONLY entries where muteUntil is an
 * actual BSON Date (type "date") AND is still in the future.
 * Everything else (null, undefined, past dates, wrong types) is discarded.
 *
 * This is safe because the query logic has also been updated to use $gt: now
 * instead of $eq: null for indefinite mutes (which now use a sentinel date).
 */

const { model } = require("mongoose");

module.exports = {
  name: "045_nuke_stale_channel_mutes",
  version: "1.0.0",
  description:
    "Remove all stale channelMutes entries using $type guard. " +
    "Keeps only entries where muteUntil is an actual Date in the future.",

  async up() {
    try {
      console.log("Starting 045_nuke_stale_channel_mutes...");

      const UserMutePreferences = model("UserMutePreferences");
      const collection = UserMutePreferences.collection;

      // Log before state
      const totalDocs = await collection.countDocuments({});
      console.log(`Total usermutepreferences documents: ${totalDocs}`);

      // Rebuild channelMutes keeping ONLY entries with a real future Date muteUntil
      const result = await collection.updateMany(
        {},
        [
          {
            $set: {
              channelMutes: {
                $filter: {
                  input: { $ifNull: ["$channelMutes", []] },
                  as: "m",
                  cond: {
                    $and: [
                      // muteUntil must be an actual BSON Date
                      { $eq: [{ $type: "$$m.muteUntil" }, "date"] },
                      // and must be in the future
                      { $gt: ["$$m.muteUntil", new Date()] }
                    ]
                  }
                }
              },
              updatedAt: new Date()
            }
          }
        ]
      );

      console.log(
        `045: matchedCount=${result.matchedCount}, modifiedCount=${result.modifiedCount}`
      );

      // Verify
      const docsWithEntries = await collection.countDocuments({
        "channelMutes.0": { $exists: true }
      });
      console.log(`Documents still having channelMutes entries: ${docsWithEntries}`);

      console.log("Migration 045 completed successfully.");
      return {
        success: true,
        message: `Cleaned channelMutes for ${result.modifiedCount} documents. ${docsWithEntries} docs still have active mute entries.`,
      };
    } catch (error) {
      console.error("Migration 045 failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    console.log("045 down: no-op. Removed stale mute entries are not recoverable.");
    return { success: true, message: "No-op rollback." };
  },
};
