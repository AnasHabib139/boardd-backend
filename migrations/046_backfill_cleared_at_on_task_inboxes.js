"use strict";

/**
 * Migration: 046_backfill_cleared_at_on_task_inboxes
 *
 * Context: We added a clearedAt timestamp to the taskinboxes collection to
 * track exactly when an item was cleared. This enables the 30-day auto-hide
 * rule — cleared items disappear from the cleared inbox view after 30 days,
 * and the timer resets whenever the user re-clears an item.
 *
 * Backfill strategy: Use updatedAt as the best available approximation of
 * when the user cleared the entry (updatedAt reflects the last toggle action).
 *
 * Effect after migration:
 *   - Entries where updatedAt > 30 days ago → gone immediately from cleared view
 *   - Entries where updatedAt <= 30 days ago → still visible, expire naturally
 */

const mongoose = require("mongoose");

module.exports = {
  name: "046_backfill_cleared_at_on_task_inboxes",
  version: "1.0.0",
  description:
    "Backfill clearedAt on existing isCleared=true taskinboxes entries using updatedAt as a proxy. " +
    "Enables the 30-day auto-hide rule for the cleared inbox view.",

  async up() {
    console.log("Starting 046_backfill_cleared_at_on_task_inboxes...");

    const TaskInbox = mongoose.connection.collection("taskinboxes");

    // Count affected docs before touching anything
    const affected = await TaskInbox.countDocuments({
      isCleared: true,
      clearedAt: { $exists: false },
    });
    console.log(`Cleared entries without clearedAt: ${affected}`);

    if (affected === 0) {
      console.log("Nothing to backfill. Migration complete.");
      return { success: true, message: "No entries needed backfilling." };
    }

    // Set clearedAt = updatedAt for all cleared entries that lack it
    const result = await TaskInbox.updateMany(
      { isCleared: true, clearedAt: { $exists: false } },
      [{ $set: { clearedAt: "$updatedAt" } }]
    );

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const expiredCount = await TaskInbox.countDocuments({
      isCleared: true,
      clearedAt: { $lt: thirtyDaysAgo },
    });

    console.log(`Backfilled: ${result.modifiedCount} entries`);
    console.log(`Of those, ${expiredCount} are older than 30 days and will no longer appear in the cleared view`);
    console.log("Migration 046 complete.");

    return { success: true, modified: result.modifiedCount, expired: expiredCount };
  },

  async down() {
    console.log("Rolling back 046 — unsetting clearedAt on all taskinboxes entries...");

    const TaskInbox = mongoose.connection.collection("taskinboxes");
    const result = await TaskInbox.updateMany(
      { clearedAt: { $exists: true } },
      { $unset: { clearedAt: "" } }
    );

    console.log(`Unset clearedAt on ${result.modifiedCount} entries.`);
    return { success: true, modified: result.modifiedCount };
  },
};
