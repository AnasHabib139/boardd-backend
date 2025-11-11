const { model } = require("mongoose");

module.exports = {
  name: "add-invoice-references-to-clients",
  version: 28,
  description: "Add invoices and subscriptions arrays to Client model stripe field for tracking invoice relationships",

  async up() {
    console.log("Starting migration: add-invoice-references-to-clients");

    const Client = model("Client");

    // Find all clients that don't have the new invoice fields
    const clientsWithoutInvoiceFields = await Client.find({
      $or: [
        { "stripe.invoices": { $exists: false } },
        { "stripe.subscriptions": { $exists: false } }
      ]
    });

    console.log(`Found ${clientsWithoutInvoiceFields.length} clients to update`);

    let updatedCount = 0;
    let errorCount = 0;

    // Update each client with the new invoice fields
    for (const client of clientsWithoutInvoiceFields) {
      try {
        const updateData = {};

        // Add invoices array if it doesn't exist
        if (!client.stripe?.invoices) {
          updateData["stripe.invoices"] = [];
        }

        // Add subscriptions array if it doesn't exist
        if (!client.stripe?.subscriptions) {
          updateData["stripe.subscriptions"] = [];
        }

        if (Object.keys(updateData).length > 0) {
          await Client.updateOne(
            { _id: client._id },
            { $set: updateData }
          );

          updatedCount++;
          console.log(`✓ Updated client ${client._id} with invoice fields`);
        }
      } catch (error) {
        console.error(`Error updating client ${client._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`Migration completed: ${updatedCount} clients updated, ${errorCount} errors`);

    return {
      success: true,
      message: `Updated ${updatedCount} clients with invoice fields`
    };
  },

  async down() {
    const Client = model("Client");

    // Remove invoice-related fields from all clients
    await Client.updateMany(
      {},
      {
        $unset: {
          "stripe.invoices": "",
          "stripe.subscriptions": ""
        }
      }
    );

    console.log("Rollback completed: Removed invoice and subscription fields from all clients");
  }
};
