const { model } = require("mongoose");

module.exports = {
  name: "006_sync_channel_conversation_participants",
  version: "1.0.0",
  description:
    "Update existing channel conversations to populate participants array from Channel.members for unread tracking",

  async up() {
    try {
      console.log("🔄 Syncing channel conversation participants...");

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

      console.log(`📊 Found ${conversations.length} channel conversations to sync`);

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

          // Check if participants array is already populated
          if (
            conversation.participants &&
            conversation.participants.length > 0
          ) {
            console.log(
              `⏭️ Conversation for channel ${channel.channelName} already has participants, skipping`
            );
            skippedCount++;
            continue;
          }

          // Populate participants from channel members
          const participants = channel.members.map((memberId) => ({
            userId: memberId,
            lastReadAt: null, // Initialize with null
          }));

          await ChatConversationModel.updateOne(
            { _id: conversation._id },
            { $set: { participants } }
          );

          updatedCount++;
          console.log(
            `✅ Synced ${participants.length} participants for channel: ${channel.channelName}`
          );
        } catch (error) {
          console.error(
            `❌ Error syncing conversation ${conversation._id}:`,
            error.message
          );
          errorCount++;
        }
      }

      console.log(`🎉 Sync completed!`);
      console.log(`   ✅ Updated: ${updatedCount} conversations`);
      console.log(`   ⏭️ Skipped: ${skippedCount} (already synced)`);
      console.log(`   ❌ Errors: ${errorCount}`);

      return {
        success: true,
        message: `Successfully synced ${updatedCount} conversations, skipped ${skippedCount}, errors ${errorCount}`,
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
      console.log("⬇️ Rolling back participant sync...");

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
