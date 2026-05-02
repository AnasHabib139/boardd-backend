"use strict";

/**
 * Migration: 047_backfill_client_conversation_twilio_number
 *
 * Context: Client conversations now store the Twilio "from" number used for
 * outbound SMS (so each channel can send from the right number instead of
 * always fromNumbers[0]). Existing conversations need that field populated.
 *
 * Strategy:
 *   1. For each client conversation missing twilioNumber, set it to the
 *      company's fromNumbers[0]. This matches the prior de-facto behavior,
 *      so no message routing changes for existing data.
 *   2. Print a conflict report: any (companyId, phone) pair appearing in
 *      more than one client conversation. These are cases that today route
 *      ambiguously on inbound and will be blocked at create-time going
 *      forward. Surfaced for ops/product to resolve manually — migration
 *      does not auto-resolve.
 */

const mongoose = require("mongoose");

module.exports = {
  name: "047_backfill_client_conversation_twilio_number",
  version: "1.0.0",
  description:
    "Backfill twilioNumber on client chatconversations using company.twilioConfig.fromNumbers[0]. " +
    "Reports cross-channel phone duplicates without modifying them.",

  async up() {
    console.log("Starting 047_backfill_client_conversation_twilio_number...");

    const ChatConversation = mongoose.connection.collection("chatconversations");
    const Company = mongoose.connection.collection("companies");

    const missing = await ChatConversation.find({
      type: "client",
      $or: [{ twilioNumber: { $exists: false } }, { twilioNumber: null }],
    }).toArray();

    console.log(`Client conversations missing twilioNumber: ${missing.length}`);

    let updated = 0;
    let skippedNoNumbers = 0;
    const companyCache = new Map();

    for (const convo of missing) {
      const companyIdStr = convo.companyId.toString();
      let fromNumbers = companyCache.get(companyIdStr);
      if (!fromNumbers) {
        const company = await Company.findOne({ _id: convo.companyId });
        fromNumbers = company?.twilioConfig?.fromNumbers || [];
        companyCache.set(companyIdStr, fromNumbers);
      }

      if (fromNumbers.length === 0) {
        skippedNoNumbers++;
        continue;
      }

      await ChatConversation.updateOne(
        { _id: convo._id },
        { $set: { twilioNumber: fromNumbers[0] } }
      );
      updated++;
    }

    console.log(`Backfilled twilioNumber on ${updated} conversations.`);
    console.log(`Skipped ${skippedNoNumbers} (company has no Twilio numbers).`);

    // Conflict report: same phone in multiple client conversations per company
    const duplicates = await ChatConversation.aggregate([
      { $match: { type: "client" } },
      {
        $project: {
          companyId: 1,
          channelId: 1,
          phones: {
            $setUnion: [
              { $ifNull: ["$externalContacts.phoneE164s", []] },
              { $ifNull: ["$externalContacts.whatsappE164s", []] },
            ],
          },
        },
      },
      { $unwind: "$phones" },
      {
        $group: {
          _id: { companyId: "$companyId", phone: "$phones" },
          count: { $sum: 1 },
          conversationIds: { $push: "$_id" },
          channelIds: { $push: "$channelId" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();

    if (duplicates.length === 0) {
      console.log("Conflict report: no cross-channel phone duplicates found.");
    } else {
      console.log(
        `Conflict report: ${duplicates.length} phone(s) appear in multiple client conversations within the same company:`
      );
      for (const d of duplicates) {
        console.log(
          `  company=${d._id.companyId} phone=${d._id.phone} count=${d.count} channels=${d.channelIds.join(",")} conversations=${d.conversationIds.join(",")}`
        );
      }
      console.log(
        "These are not auto-resolved. New attempts to add a duplicated phone to another channel will be rejected at create-time."
      );
    }

    console.log("Migration 047 complete.");
    return {
      success: true,
      backfilled: updated,
      skippedNoNumbers,
      conflicts: duplicates.length,
    };
  },

  async down() {
    console.log("Rolling back 047 — unsetting twilioNumber on all client conversations...");
    const ChatConversation = mongoose.connection.collection("chatconversations");
    const result = await ChatConversation.updateMany(
      { type: "client", twilioNumber: { $exists: true } },
      { $unset: { twilioNumber: "" } }
    );
    console.log(`Unset twilioNumber on ${result.modifiedCount} conversations.`);
    return { success: true, modified: result.modifiedCount };
  },
};
