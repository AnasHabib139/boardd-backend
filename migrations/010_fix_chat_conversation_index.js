const { model } = require("mongoose");

module.exports = {
  name: "010_fix_chat_conversation_index",
  version: "1.0.0",
  description:
    "Fix duplicate key error on chat conversations by replacing the sparse unique index with a partial index that only applies to channel and client types. This allows DM/group_dm conversations to have channelId: null without conflicts.",

  async up() {
    try {
      console.log("🔄 Fixing chat conversation index...");

      const ChatConversationModel = model("ChatConversation");
      const collection = ChatConversationModel.collection;

      // Step 1: Drop the old problematic index
      try {
        await collection.dropIndex("companyId_1_type_1_channelId_1");
        console.log("✅ Dropped old index: companyId_1_type_1_channelId_1");
      } catch (error) {
        // Index might not exist if already dropped
        if (error.code === 27) {
          console.log("ℹ️ Index already dropped or doesn't exist, continuing...");
        } else {
          throw error;
        }
      }

      // Step 2: Create the new partial index
      await collection.createIndex(
        { companyId: 1, type: 1, channelId: 1 },
        {
          unique: true,
          partialFilterExpression: {
            type: { $in: ["channel", "client"] },
            channelId: { $ne: null },
          },
          name: "companyId_1_type_1_channelId_1",
        }
      );
      console.log(
        "✅ Created new partial index with filter: type in [channel, client] and channelId != null"
      );

      // Step 3: Verify the index
      const indexes = await collection.indexes();
      const newIndex = indexes.find((idx) => idx.name === "companyId_1_type_1_channelId_1");

      if (newIndex && newIndex.partialFilterExpression) {
        console.log("✅ Index successfully created with partial filter");
        console.log(
          `   Filter: ${JSON.stringify(newIndex.partialFilterExpression)}`
        );
      } else {
        console.warn("⚠️ Index created but partial filter may not be applied");
      }

      console.log("🎉 Migration completed successfully!");

      return {
        success: true,
        message: "Successfully updated chat conversation index to use partial filtering",
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
      console.log("⬇️ Rolling back chat conversation index fix...");

      const ChatConversationModel = model("ChatConversation");
      const collection = ChatConversationModel.collection;

      // Step 1: Drop the partial index
      try {
        await collection.dropIndex("companyId_1_type_1_channelId_1");
        console.log("✅ Dropped partial index: companyId_1_type_1_channelId_1");
      } catch (error) {
        if (error.code === 27) {
          console.log("ℹ️ Index already dropped or doesn't exist");
        } else {
          throw error;
        }
      }

      // Step 2: Recreate the old sparse unique index
      await collection.createIndex(
        { companyId: 1, type: 1, channelId: 1 },
        {
          unique: true,
          sparse: true,
          name: "companyId_1_type_1_channelId_1",
        }
      );
      console.log(
        "✅ Recreated old sparse unique index (WARNING: This will reintroduce the duplicate key error for DMs)"
      );

      console.log("⚠️ Rollback completed! Note: This restores the problematic behavior.");

      return {
        success: true,
        message: "Successfully rolled back to old index (restores duplicate key issue)",
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
