#!/usr/bin/env node

/**
 * Script to fix migration issues by removing failed migration records
 * Run this on your server to clean up the duplicate migration error
 */

const mongoose = require("mongoose");
require("dotenv").config();

const migrationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    executedAt: { type: Date, default: Date.now },
    version: { type: String, required: true },
    description: { type: String },
    success: { type: Boolean, default: true },
    error: { type: String },
  },
  { timestamps: true }
);

const MigrationModel = mongoose.model("Migration", migrationSchema);

async function fixMigrationIssue() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const migrationName = "002-migrate-local-files-to-s3";

    // Check current status
    const existingMigration = await MigrationModel.findOne({
      name: migrationName,
    });

    if (existingMigration) {
      console.log(`📋 Found existing migration record:`);
      console.log(`   Name: ${existingMigration.name}`);
      console.log(`   Success: ${existingMigration.success}`);
      console.log(`   Executed At: ${existingMigration.executedAt}`);
      console.log(`   Error: ${existingMigration.error || "None"}`);

      if (!existingMigration.success) {
        console.log(`🗑️ Removing failed migration record to allow retry...`);
        await MigrationModel.deleteOne({ name: migrationName });
        console.log(`✅ Removed failed migration record`);
        console.log(`🔄 Migration will now be able to run again`);
      } else {
        console.log(`ℹ️ Migration was successful, no action needed`);
      }
    } else {
      console.log(`ℹ️ No migration record found for ${migrationName}`);
    }

    console.log(`✅ Migration fix completed`);
  } catch (error) {
    console.error("❌ Error fixing migration:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

// Run the fix
fixMigrationIssue().catch(console.error);
