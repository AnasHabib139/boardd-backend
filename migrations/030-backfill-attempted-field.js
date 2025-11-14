const { model } = require("mongoose");

module.exports = {
  name: "backfill-attempted-field",
  version: 30,
  description: "Backfill attempted, attemptCount, and paymentIntentId fields for existing invoices by fetching data from Stripe",

  async up() {
    console.log("Starting migration: backfill-attempted-field");

    const Invoice = model("Invoice");
    const PaymentsStripeAccount = model("PaymentsStripeAccount");

    // Initialize Stripe
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    // Find all invoices that have a Stripe invoice ID but no attempted field set
    const invoicesNeedingUpdate = await Invoice.find({
      stripeInvoiceId: { $exists: true, $ne: null },
      $or: [
        { attempted: { $exists: false } },
        { attempted: null }
      ]
    });

    console.log(`Found ${invoicesNeedingUpdate.length} invoices to check and update`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each invoice
    for (const invoice of invoicesNeedingUpdate) {
      try {
        // Get the connected account ID for this invoice
        const account = await PaymentsStripeAccount.findOne({ companyId: invoice.companyId });

        if (!account || !account.stripeAccountId) {
          console.log(`⚠️  Skipped invoice ${invoice._id}: No connected account found for company ${invoice.companyId}`);
          skippedCount++;
          continue;
        }

        // Fetch invoice from Stripe to get attempted status
        try {
          const stripeInvoice = await stripe.invoices.retrieve(
            invoice.stripeInvoiceId,
            {
              stripeAccount: account.stripeAccountId
            }
          );

          // Update invoice with attempted status from Stripe
          const updateData = {
            attempted: stripeInvoice.attempted || false,
            attemptCount: stripeInvoice.attempt_count || 0
          };

          // Add payment intent ID if available
          if (stripeInvoice.payment_intent) {
            updateData.paymentIntentId = stripeInvoice.payment_intent;
          }

          await Invoice.updateOne(
            { _id: invoice._id },
            { $set: updateData }
          );

          updatedCount++;
          console.log(`✓ Updated invoice ${invoice._id}: attempted=${updateData.attempted}, attemptCount=${updateData.attemptCount}`);

        } catch (stripeError) {
          // Handle case where invoice doesn't exist in Stripe anymore
          if (stripeError.code === 'resource_missing') {
            console.log(`⚠️  Skipped invoice ${invoice._id}: Invoice ${invoice.stripeInvoiceId} not found in Stripe (may have been deleted)`);
            skippedCount++;
          } else {
            throw stripeError;
          }
        }

      } catch (error) {
        console.error(`❌ Error updating invoice ${invoice._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`Migration completed: ${updatedCount} invoices updated, ${skippedCount} skipped, ${errorCount} errors`);

    return {
      success: true,
      message: `Backfilled attempted field for ${updatedCount} invoices`
    };
  },

  async down() {
    console.log("Rolling back migration: backfill-attempted-field");
    console.log("Note: This will remove attempted, attemptCount, and paymentIntentId fields from all invoices");

    const Invoice = model("Invoice");

    // Remove the fields that were added
    await Invoice.updateMany(
      {},
      {
        $unset: {
          attempted: "",
          attemptCount: "",
          paymentIntentId: ""
        }
      }
    );

    console.log("Rollback completed: Removed attempted fields from all invoices");

    return {
      success: true,
      message: "Rolled back attempted field additions"
    };
  }
};
