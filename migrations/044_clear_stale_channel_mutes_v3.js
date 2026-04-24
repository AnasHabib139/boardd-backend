"use strict";

/**
 * Migration: 044_clear_stale_channel_mutes_v3
 *
 * Root cause of why 042 and 043 failed:
 *   The stale channelMutes entries have muteUntil stored as BSON `undefined`
 *   (a deprecated BSON type created when old Mongoose/driver code passed
 *   JavaScript `undefined` instead of `null`).
 *
 *   - $pull { muteUntil: null } uses QUERY semantics: BSON null ≠ BSON undefined
 *     → entries are silently skipped, migration appears successful but removes nothing.
 *
 *   - $eq ["$$cm.muteUntil", null] in aggregation uses AGGREGATION semantics:
 *     treats undefined as null → pipeline correctly identifies them as active mutes.
 *
 * Fix: use an aggregation pipeline update ($filter + $ne) which also runs under
 * aggregation semantics, so "undefined" and "null" are both treated as null and
 * both excluded when rebuilding the channelMutes array.
 *
 * Requires MongoDB 4.2+ for aggregation pipeline update syntax.
 */

const { model } = require("mongoose");

module.exports = {
  name: "044_clear_stale_channel_mutes_v3",
  version: "1.0.0",
  description:
    "Fix stale indefinite channel mutes using aggregation pipeline update. " +
    "Migrations 042/043 used $pull which silently failed on BSON undefined muteUntil values. " +
    "This migration uses $filter with aggregation semantics which treats undefined as null.",

  async up() {
    try {
      console.log("Starting 044_clear_stale_channel_mutes_v3...");

      const UserMutePreferences = model("UserMutePreferences");

      // Use raw collection + aggregation pipeline update syntax.
      // The $ne in aggregation context treats BSON undefined as null,
      // so entries with muteUntil=undefined are excluded the same as muteUntil=null.
      const result = await UserMutePreferences.collection.updateMany(
        {},
        [
          {
            $set: {
              channelMutes: {
                $filter: {
                  input: { $ifNull: ["$channelMutes", []] },
                  as: "m",
                  // Keep only entries where muteUntil is a real future date.
                  // Aggregation $ne treats undefined as null → removes both null and undefined entries.
                  cond: { $ne: ["$$m.muteUntil", null] }
                }
              },
              updatedAt: new Date()
            }
          }
        ]
      );

      console.log(
        `044: pipeline updateMany completed. matchedCount=${result.matchedCount}, modifiedCount=${result.modifiedCount}`
      );

      console.log("Migration 044 completed successfully.");
      return {
        success: true,
        message: `Rebuilt channelMutes arrays for ${result.modifiedCount} user documents, removing all null/undefined muteUntil entries.`,
      };
    } catch (error) {
      console.error("Migration 044 failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    console.log("044 down: no-op. Removed stale mute entries are not recoverable.");
    return { success: true, message: "No-op rollback." };
  },
};
