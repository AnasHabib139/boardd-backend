/**
 * Migration: Add companyId to existing clients
 *
 * This migration updates all client documents that don't have a companyId
 * by fetching the companyId from their associated tab.
 */

const { model } = require("mongoose");

module.exports = {
  name: "add-companyId-to-clients",
  version: 27,
  description: "Add companyId field to existing client documents by fetching from their associated tabs",

  async up() {
    console.log("Starting migration: add-companyId-to-clients");

    const Client = model("Client");
    const ChannelTab = model("ChannelTab");

    // Find all clients without companyId
    const clientsWithoutCompany = await Client.find({
      $or: [
        { companyId: { $exists: false } },
        { companyId: null }
      ]
    });

    console.log(`Found ${clientsWithoutCompany.length} clients without companyId`);

    let updatedCount = 0;
    let errorCount = 0;

    // Update each client with companyId from its tab
    for (const client of clientsWithoutCompany) {
      try {
        // Find the tab for this client
        const tab = await ChannelTab.findOne({ _id: client.tabId });

        if (!tab) {
          console.error(`Tab not found for client ${client._id} (tabId: ${client.tabId})`);
          errorCount++;
          continue;
        }

        if (!tab.companyId) {
          console.error(`Tab ${tab._id} has no companyId for client ${client._id}`);
          errorCount++;
          continue;
        }

        // Update client with companyId
        await Client.updateOne(
          { _id: client._id },
          { $set: { companyId: tab.companyId } }
        );

        updatedCount++;
        console.log(`✓ Updated client ${client._id} with companyId ${tab.companyId}`);

      } catch (error) {
        console.error(`Error updating client ${client._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`Migration completed: ${updatedCount} clients updated, ${errorCount} errors`);
  },

  async down() {
    console.log("Rolling back migration: add-companyId-to-clients");

    const Client = model("Client");

    // Remove companyId field from all clients
    await Client.updateMany(
      {},
      { $unset: { companyId: "" } }
    );

    console.log("Rollback completed: Removed companyId field from all clients");
  }
};
