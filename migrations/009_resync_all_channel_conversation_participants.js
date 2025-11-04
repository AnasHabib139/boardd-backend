const { model } = require("mongoose");

module.exports = {
  name: "009_resync_all_channel_conversation_participants",
  version: "1.0.0",
  description:
    "Resync ALL channel conversation participants (including those with partial participants) to match current Channel.members. This fixes conversations where members were added but not synced to participants array.",

  async up() {
    try {
      console.log("🔄 Resyncing ALL channel conversation participants...");

      const ChannelModel = model("Channel");
      const ChatConversationModel = model("ChatConversation");

      // Get all channel-type conversations
      const conversations = await ChatConversationModel.find({
        type: "channel",
      });

      if (conversations.length === 0) {
        console.log("ℹ️ No channel conversations found to sync");
        return { success: true, message: "No channel conversations to sync" };
      }

      console.log(
        `📊 Found ${conversations.length} channel conversations to resync`
      );

      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const conversation of conversations) {
        try {
          // Get the channel
          const channel = await ChannelModel.findById(conversation.channelId);

          if (!channel) {
            console.log(
              `⚠️ Channel not found for conversation ${conversation._id}, skipping`
            );
            errorCount++;
            continue;
          }

          // Get current participant user IDs
          const currentParticipantIds = conversation.participants.map((p) =>
            p.userId.toString()
          );

          // Get channel member IDs
          const channelMemberIds = channel.members.map((id) => id.toString());

          // Check if participants match channel members
          const participantIdsSet = new Set(currentParticipantIds);
          const memberIdsSet = new Set(channelMemberIds);

          const hasAllMembers =
            participantIdsSet.size === memberIdsSet.size &&
            [...participantIdsSet].every((id) => memberIdsSet.has(id));

          if (hasAllMembers) {
            console.log(
              `✓ Conversation for channel ${channel.channelName} already has all current members, skipping`
            );
            skippedCount++;
            continue;
          }

          // Preserve existing lastReadAt values for users who are already participants
          const existingReadStatus = {};
          conversation.participants.forEach((p) => {
            if (p.lastReadAt) {
              existingReadStatus[p.userId.toString()] = p.lastReadAt;
            }
          });

          // Build new participants array from channel members
          const participants = channel.members.map((memberId) => ({
            userId: memberId,
            lastReadAt: existingReadStatus[memberId.toString()] || null,
          }));

          // Update conversation with full participant list
          await ChatConversationModel.updateOne(
            { _id: conversation._id },
            { $set: { participants } }
          );

          updatedCount++;
          console.log(
            `✅ Resynced ${participants.length} participants for channel: ${channel.channelName} (was ${currentParticipantIds.length})`
          );
        } catch (error) {
          console.error(
            `❌ Error resyncing conversation ${conversation._id}:`,
            error.message
          );
          errorCount++;
        }
      }

      console.log(`🎉 Resync completed!`);
      console.log(`   ✅ Updated: ${updatedCount} conversations`);
      console.log(`   ⏭️ Skipped: ${skippedCount} (already fully synced)`);
      console.log(`   ❌ Errors: ${errorCount}`);

      return {
        success: true,
        message: `Successfully resynced ${updatedCount} conversations, skipped ${skippedCount}, errors ${errorCount}`,
      };
    } catch (error) {
      console.error("❌ Migration failed:", error);
      return {
        success: false,
        message: `Migration failed: ${error.message}`,
      };
    }
  },

  async down() {
    try {
      console.log("⬇️ Rolling back participant resync...");
      console.log(
        "⚠️ Note: This rollback will only clear participants. Manual data restoration may be required."
      );

      const ChatConversationModel = model("ChatConversation");

      // Clear participants array for all channel conversations
      const result = await ChatConversationModel.updateMany(
        { type: "channel" },
        { $set: { participants: [] } }
      );

      console.log(
        `✅ Rollback completed! Cleared participants for ${result.modifiedCount} conversations`
      );

      return {
        success: true,
        message: `Successfully cleared participants for ${result.modifiedCount} conversations`,
      };
    } catch (error) {
      console.error("❌ Rollback failed:", error);
      return {
        success: false,
        message: `Rollback failed: ${error.message}`,
      };
    }
  },
};
