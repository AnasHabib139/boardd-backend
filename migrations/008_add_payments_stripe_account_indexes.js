const { model } = require("mongoose");

module.exports = {
  name: "008_add_payments_stripe_account_indexes",
  version: "1.0.0",
  description:
    "Add indexes for PaymentsStripeAccount collection for Stripe Connect onboarding",

  async up() {
    try {
      console.log("🔄 Starting Payments Stripe Account indexes migration...");

      const PaymentsStripeAccount = model("PaymentsStripeAccount");

      // Ensure indexes are created
      console.log("📊 Creating indexes for PaymentsStripeAccount collection...");

      await PaymentsStripeAccount.collection.createIndex(
        { companyId: 1, stripeAccountId: 1 },
        { name: "companyId_stripeAccountId_index" }
      );

      await PaymentsStripeAccount.collection.createIndex(
        { stripeAccountId: 1 },
        { unique: true, name: "stripeAccountId_unique_index" }
      );

      await PaymentsStripeAccount.collection.createIndex(
        { companyId: 1, onboardingComplete: 1 },
        { name: "companyId_onboardingComplete_index" }
      );

      console.log("✅ Indexes created successfully");

      // Check if any existing data needs migration
      const existingAccounts = await PaymentsStripeAccount.countDocuments();
      console.log(
        `ℹ️ Found ${existingAccounts} existing Stripe accounts in database`
      );

      console.log("🎉 Migration completed successfully!");

      return {
        success: true,
        message: `Successfully created indexes for PaymentsStripeAccount collection`,
      };
    } catch (error) {
      // If error is about index already existing, that's okay
      if (error.code === 85 || error.message.includes("already exists")) {
        console.log("ℹ️ Indexes already exist, skipping creation");
        return {
          success: true,
          message: "Indexes already exist",
        };
      }

      console.error("❌ Migration failed:", error);
      return {
        success: false,
        message: `Migration failed: ${error.message}`,
      };
    }
  },

  async down() {
    try {
      console.log("⬇️ Rolling back Payments Stripe Account indexes...");

      const PaymentsStripeAccount = model("PaymentsStripeAccount");

      // Drop the indexes
      try {
        await PaymentsStripeAccount.collection.dropIndex(
          "companyId_stripeAccountId_index"
        );
        console.log("✅ Dropped companyId_stripeAccountId_index");
      } catch (error) {
        console.log("ℹ️ companyId_stripeAccountId_index does not exist");
      }

      try {
        await PaymentsStripeAccount.collection.dropIndex(
          "stripeAccountId_unique_index"
        );
        console.log("✅ Dropped stripeAccountId_unique_index");
      } catch (error) {
        console.log("ℹ️ stripeAccountId_unique_index does not exist");
      }

      try {
        await PaymentsStripeAccount.collection.dropIndex(
          "companyId_onboardingComplete_index"
        );
        console.log("✅ Dropped companyId_onboardingComplete_index");
      } catch (error) {
        console.log("ℹ️ companyId_onboardingComplete_index does not exist");
      }

      console.log("🎉 Rollback completed successfully!");

      return {
        success: true,
        message: "Successfully removed PaymentsStripeAccount indexes",
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
