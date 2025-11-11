#!/usr/bin/env node

require("dotenv").config();
const DB_CONNECT = require("../config/dbConnect");
const migrationRunner = require("../utils/migrationRunner");
const { getExecutedMigrations } = require("../models/migrationModel");

// Load all models so migrations can use them
// This is required because migrations use model("ModelName") to access models
require("../models/clientModel");
require("../models/channelTabsModel");
require("../models/invoiceModel");

const commands = {
  // Run pending migrations
  up: async () => {
    console.log("🚀 Running pending migrations...");
    const result = await migrationRunner.runPendingMigrations();
    if (result.executed === 0) {
      console.log("✅ No pending migrations");
    }
    return result;
  },

  // Rollback last migration
  down: async () => {
    console.log("⬇️ Rolling back last migration...");
    const result = await migrationRunner.rollbackLastMigration();
    return result;
  },

  // Show migration status
  status: async () => {
    console.log("📋 Migration Status:");
    const executed = await getExecutedMigrations();

    if (executed.length === 0) {
      console.log("ℹ️ No migrations have been executed");
    } else {
      console.log(`✅ Executed migrations (${executed.length}):`);
      executed.forEach((migration) => {
        console.log(
          `  - ${migration.name} (${
            migration.version
          }) - ${migration.executedAt.toISOString()}`
        );
        if (migration.description) {
          console.log(`    📝 ${migration.description}`);
        }
      });
    }

    return { success: true, count: executed.length };
  },
};

const runCommand = async (command) => {
  try {
    // Connect to database
    await DB_CONNECT();

    // Execute command
    if (commands[command]) {
      const result = await commands[command]();
      console.log("🎉 Command completed successfully");
      return result;
    } else {
      console.error("❌ Unknown command:", command);
      console.log("Available commands: up, down, status");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Command failed:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
};

// Parse command line arguments
const command = process.argv[2] || "up";

// Show help
if (command === "help" || command === "--help" || command === "-h") {
  console.log(`
📚 Migration CLI Tool

Usage: node scripts/migrate.js [command]

Commands:
  up      Run all pending migrations (default)
  down    Rollback the last migration
  status  Show executed migrations
  help    Show this help message

Examples:
  node scripts/migrate.js up
  node scripts/migrate.js status
  node scripts/migrate.js down
  `);
  process.exit(0);
}

// Run the command
runCommand(command);
