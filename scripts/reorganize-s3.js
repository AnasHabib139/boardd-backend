#!/usr/bin/env node

/**
 * Script to run the S3 reorganization migration
 * This will move documents/ and images/ folders into uploadFiles/
 */

require("dotenv").config();

async function runReorganization() {
  try {
    console.log("🔧 Loading S3 reorganization migration...");

    // Load the migration
    const migration = require("../migrations/003-reorganize-s3-structure");

    console.log(`📋 Migration: ${migration.name}`);
    console.log(`📝 Description: ${migration.description}`);
    console.log(`🔢 Version: ${migration.version}`);

    // Check environment variables
    const requiredEnvVars = [
      "AWS_ACCESS_KEY",
      "AWS_SECRET_KEY",
      "AWS_REGION",
      "AWS_BUCKET_NAME",
    ];

    console.log("\n🔍 Checking environment variables...");
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
      console.log(
        `✅ ${envVar}: ${
          envVar === "AWS_SECRET_KEY" ? "***" : process.env[envVar]
        }`
      );
    }

    console.log("\n🚀 Starting S3 reorganization...");
    console.log(
      "⚠️ This will move files in your S3 bucket. Make sure you have backups!"
    );

    // Run the migration
    const result = await migration.up();

    if (result.success) {
      console.log(`\n✅ Migration completed successfully!`);
      console.log(`📄 ${result.message}`);

      if (result.stats) {
        console.log("\n📊 Final Statistics:");
        console.log(`   - Total processed: ${result.stats.totalProcessed}`);
        console.log(`   - Successfully copied: ${result.stats.copied}`);
        console.log(`   - Originals deleted: ${result.stats.deleted}`);
        console.log(`   - Failed operations: ${result.stats.failed}`);
      }
    } else {
      console.error(`\n❌ Migration failed: ${result.message}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error running S3 reorganization:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

// Show warning and run
console.log("⚠️  S3 REORGANIZATION SCRIPT");
console.log(
  "📁 This will move documents/ and images/ folders into uploadFiles/"
);
console.log("🔄 Files will be copied to new locations and originals deleted");
console.log("💾 Make sure you have backups before proceeding!");
console.log("");

runReorganization().catch(console.error);
