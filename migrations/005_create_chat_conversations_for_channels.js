const { model } = require("mongoose");

module.exports = {
  name: "005_create_chat_conversations_for_channels",
  version: "1.0.0",
  description:
    "Create ChatConversation records for all existing channels to enable chat functionality",

  async up() {
    try {
      console.log("🔄 Starting chat conversations migration for existing channels...");

      const ChannelModel = model("Channel");
      const ChatConversationModel = model("ChatConversation");

      // Get ALL channels (including archived) to ensure chat is ready if they get unarchived
      const channels = await ChannelModel.find({});

      if (channels.length === 0) {
        console.log("ℹ️ No channels found to migrate");
        return { success: true, message: "No channels to migrate" };
      }

      console.log(`📊 Found ${channels.length} channels to create conversations for`);

      let createdCount = 0;
      let skippedCount = 0;
      const batchSize = 100;

      // Process channels in batches
      for (let i = 0; i < channels.length; i += batchSize) {
        const batch = channels.slice(i, i + batchSize);

        console.log(
          `🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(channels.length / batchSize)}...`
        );

        for (const channel of batch) {
          // Check if conversation already exists
          const existingConversation = await ChatConversationModel.findOne({
            companyId: channel.companyId,
            type: "channel",
            channelId: channel._id,
          });

          if (existingConversation) {
            console.log(
              `⏭️ Conversation already exists for channel: ${channel.channelName} (${channel._id})`
            );
            skippedCount++;
            continue;
          }

          // Create chat conversation for this channel with participants synced from channel members
          await ChatConversationModel.create({
            companyId: channel.companyId,
            type: "channel",
            channelId: channel._id,
            participantIds: [], // Empty for channel type - members stored in participants array
            participants: channel.members.map((memberId) => ({
              userId: memberId,
              lastReadAt: null, // Initialize with null - will be set when user first reads chat
            })),
            lastMessageAt: null,
            lastMessageText: "",
            createdBy: channel.createdBy,
            createdAt: channel.createdAt,
            updatedAt: channel.updatedAt,
          });

          createdCount++;
          console.log(
            `✅ Created conversation for channel: ${channel.channelName} (${channel._id})`
          );
        }
      }

      console.log(`🎉 Migration completed!`);
      console.log(`   ✅ Created: ${createdCount} conversations`);
      console.log(`   ⏭️ Skipped: ${skippedCount} (already existed)`);

      return {
        success: true,
        message: `Successfully created ${createdCount} chat conversations, skipped ${skippedCount}`,
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
      console.log("⬇️ Rolling back chat conversations for channels...");

      const ChatConversationModel = model("ChatConversation");

      // Delete all channel-type conversations
      const result = await ChatConversationModel.deleteMany({
        type: "channel",
      });

      console.log(
        `✅ Rollback completed! Removed ${result.deletedCount} channel conversations`
      );

      return {
        success: true,
        message: `Successfully removed ${result.deletedCount} channel conversations`,
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
