const { model } = require("mongoose");

module.exports = {
  name: "fix-default-payment-method",
  version: 29,
  description: "Fix clients where a payment method has isDefault: true but stripe.defaultPaymentMethod is null or missing",

  async up() {
    console.log("Starting migration: fix-default-payment-method");

    const Client = model("Client");

    // Find all clients that have payment methods with isDefault: true but defaultPaymentMethod is null/missing
    const clientsWithInconsistentDefaults = await Client.find({
      "stripe.paymentMethods": { $exists: true, $ne: [] },
      $or: [
        { "stripe.defaultPaymentMethod": { $exists: false } },
        { "stripe.defaultPaymentMethod": null },
        { "stripe.defaultPaymentMethod": "" }
      ]
    });

    console.log(`Found ${clientsWithInconsistentDefaults.length} clients to check`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Update each client with inconsistent default payment method
    for (const client of clientsWithInconsistentDefaults) {
      try {
        // Find the payment method marked as default
        const defaultPaymentMethod = client.stripe?.paymentMethods?.find(
          pm => pm.isDefault === true
        );

        if (defaultPaymentMethod) {
          // Update the defaultPaymentMethod field to match the isDefault payment method
          await Client.updateOne(
            { _id: client._id },
            {
              $set: {
                "stripe.defaultPaymentMethod": defaultPaymentMethod.paymentMethodId,
                updatedAt: new Date()
              }
            }
          );

          updatedCount++;
          console.log(`✓ Updated client ${client._id} - set defaultPaymentMethod to ${defaultPaymentMethod.paymentMethodId}`);
        } else {
          // Client has payment methods but none marked as default - skip
          skippedCount++;
          console.log(`- Skipped client ${client._id} - has payment methods but none marked as default`);
        }
      } catch (error) {
        console.error(`Error updating client ${client._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`Migration completed: ${updatedCount} clients updated, ${skippedCount} skipped (no default marked), ${errorCount} errors`);

    return {
      success: true,
      message: `Updated ${updatedCount} clients with default payment method`
    };
  },

  async down() {
    console.log("Rolling back migration: fix-default-payment-method");
    console.log("Note: This rollback will set defaultPaymentMethod to null for clients that were updated.");
    console.log("This may not fully restore the original state, as we cannot distinguish which clients were updated by this migration.");

    const Client = model("Client");

    // Find clients with a default payment method that matches a payment method marked as default
    const clientsToRollback = await Client.find({
      "stripe.defaultPaymentMethod": { $exists: true, $ne: null },
      "stripe.paymentMethods.isDefault": true
    });

    console.log(`Found ${clientsToRollback.length} clients to rollback`);

    let rolledBackCount = 0;

    for (const client of clientsToRollback) {
      try {
        const defaultPaymentMethod = client.stripe?.paymentMethods?.find(
          pm => pm.isDefault === true
        );

        // Only rollback if the defaultPaymentMethod matches the payment method marked as default
        // (i.e., it was likely set by this migration)
        if (defaultPaymentMethod && client.stripe?.defaultPaymentMethod === defaultPaymentMethod.paymentMethodId) {
          await Client.updateOne(
            { _id: client._id },
            {
              $set: {
                "stripe.defaultPaymentMethod": null,
                updatedAt: new Date()
              }
            }
          );

          rolledBackCount++;
          console.log(`✓ Rolled back client ${client._id}`);
        }
      } catch (error) {
        console.error(`Error rolling back client ${client._id}:`, error.message);
      }
    }

    console.log(`Rollback completed: ${rolledBackCount} clients rolled back`);
  }
};
