"use strict";

/**
 * Migration: 042_clear_stale_channel_mutes
 *
 * Problem: All users' channelMutes arrays were populated with indefinite mutes
 * (muteUntil: null) for every channel during development/testing. This stale
 * data causes the GET /api/channel-groups endpoint to show isMuted: true for
 * every channel for every user, even though no intentional mute was set.
 *
 * What this migration does:
 *   UP   — Removes only indefinite (muteUntil: null) entries from channelMutes
 *          for all users. Timed mutes (muteUntil: future Date) are preserved.
 *
 *   DOWN — Cannot restore removed entries (data was already garbage). No-op.
 */

const { model, Types } = require("mongoose");

module.exports = {
  name: "042_clear_stale_channel_mutes",
  version: "1.0.0",
  description:
    "Remove stale indefinite channel mutes (muteUntil: null) from all users. " +
    "These were created during testing and cause every channel to appear muted for every user.",

  async up() {
    try {
      console.log("Starting 042_clear_stale_channel_mutes...");

      const UserMutePreferences = model("UserMutePreferences");

      // 1. Count how many docs are affected before touching anything
      const affectedDocs = await UserMutePreferences.countDocuments({
        "channelMutes.muteUntil": null,
      });
      console.log(`Docs with at least one indefinite channel mute: ${affectedDocs}`);

      if (affectedDocs === 0) {
        console.log("Nothing to clean up. Migration complete.");
        return { success: true, message: "No stale data found." };
      }

      // 2. Count total stale entries across all docs (for reporting)
      const sample = await UserMutePreferences.aggregate([
        { $match: { "channelMutes.muteUntil": null } },
        {
          $project: {
            staleCount: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$channelMutes", []] },
                  as: "m",
                  cond: { $eq: ["$$m.muteUntil", null] },
                },
              },
            },
          },
        },
        { $group: { _id: null, totalStale: { $sum: "$staleCount" } } },
      ]);
      const totalStale = sample[0]?.totalStale ?? 0;
      console.log(`Total stale channel mute entries to remove: ${totalStale}`);

      // 3. Pull all indefinite (muteUntil: null) channelMutes entries
      const result = await UserMutePreferences.updateMany(
        { "channelMutes.muteUntil": null },
        {
          $pull: { channelMutes: { muteUntil: null } },
          $set: { updatedAt: new Date() },
        }
      );

      console.log(
        `Cleaned ${result.modifiedCount} user documents. ` +
        `Removed ~${totalStale} stale indefinite mute entries.`
      );

      // 4. Verify: no indefinite entries should remain
      const remaining = await UserMutePreferences.countDocuments({
        "channelMutes.muteUntil": null,
      });
      if (remaining > 0) {
        console.warn(`WARNING: ${remaining} docs still have indefinite channel mutes after migration.`);
      } else {
        console.log("Verification passed: no indefinite channel mutes remain.");
      }

      console.log("Migration 042 completed successfully.");
      return {
        success: true,
        message: `Removed ${totalStale} stale indefinite channel mute entries from ${result.modifiedCount} users.`,
      };
    } catch (error) {
      console.error("Migration 042 failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    // Removed entries cannot be restored — they were garbage data.
    console.log(
      "042 down: nothing to restore. Stale channel mute entries are not recoverable."
    );
    return { success: true, message: "No-op rollback." };
  },
};
