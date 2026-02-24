"use strict";

const { model } = require("mongoose");

module.exports = {
  name: "041_update_domain_unique_index",
  version: "1.0.0",
  description:
    "Replace blanket unique index on Company.domain with partial unique index excluding consumer domain companies. Add isConsumerDomain field.",

  async up() {
    try {
      console.log("Starting domain index migration...");
      const CompanyModel = model("Company");
      const collection = CompanyModel.collection;

      // Phase 1: Backfill isConsumerDomain = false on all existing companies
      const updateResult = await CompanyModel.updateMany(
        { isConsumerDomain: { $exists: false } },
        { $set: { isConsumerDomain: false } }
      );
      console.log(
        `Phase 1: Set isConsumerDomain=false on ${updateResult.modifiedCount} companies`
      );

      // Phase 2: Drop old unique index on domain
      try {
        await collection.dropIndex("domain_1");
        console.log("Phase 2: Dropped old domain_1 unique index");
      } catch (err) {
        if (err.codeName === "IndexNotFound" || err.code === 27) {
          console.log("Phase 2: domain_1 index not found, skipping drop");
        } else {
          throw err;
        }
      }

      // Phase 3: Create partial unique index
      await collection.createIndex(
        { domain: 1 },
        {
          unique: true,
          partialFilterExpression: { isConsumerDomain: { $ne: true } },
          name: "domain_1_non_consumer_unique",
        }
      );
      console.log(
        "Phase 3: Created partial unique index domain_1_non_consumer_unique"
      );

      console.log("Migration completed successfully!");
      return {
        success: true,
        message: `Updated ${updateResult.modifiedCount} companies, replaced domain index.`,
      };
    } catch (error) {
      console.error("Migration failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    try {
      console.log("Rolling back domain index migration...");
      const CompanyModel = model("Company");
      const collection = CompanyModel.collection;

      // Drop partial index
      try {
        await collection.dropIndex("domain_1_non_consumer_unique");
      } catch (err) {
        console.log("Partial index not found, skipping");
      }

      // Recreate original unique index
      await collection.createIndex({ domain: 1 }, { unique: true });

      // Remove isConsumerDomain field
      await CompanyModel.updateMany({}, { $unset: { isConsumerDomain: "" } });

      console.log("Rollback completed");
      return { success: true, message: "Rolled back domain index" };
    } catch (error) {
      console.error("Rollback failed:", error);
      return {
        success: false,
        message: `Rollback failed: ${error.message}`,
      };
    }
  },
};
