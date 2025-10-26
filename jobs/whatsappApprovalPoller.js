"use strict";

/**
 * WhatsApp Template Approval Polling Job
 *
 * Background job that checks Meta approval status for pending WhatsApp templates
 * Should be run periodically (e.g., hourly or daily)
 *
 * Usage:
 *   node jobs/whatsappApprovalPoller.js
 *
 * Or via cron:
 *   0 * * * * cd /path/to/boardd-backend && node jobs/whatsappApprovalPoller.js
 */

const whatsappTemplateService = require("../services/whatsappTemplateService");

async function runApprovalPoller() {
  try {
    console.log("=".repeat(60));
    console.log("WhatsApp Template Approval Poller - Starting");
    console.log("Time:", new Date().toISOString());
    console.log("=".repeat(60));

    // Poll approval status for all companies
    const result = await whatsappTemplateService.pollApprovalStatus();

    console.log("\nResults:");
    console.log(`  Templates checked: ${result.updatedCount}`);
    console.log(`  Status: ${result.success ? "✓ Success" : "✗ Failed"}`);

    console.log("\n" + "=".repeat(60));
    console.log("WhatsApp Template Approval Poller - Complete");
    console.log("=".repeat(60));

    // Exit successfully
    process.exit(0);
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("WhatsApp Template Approval Poller - ERROR");
    console.error("=".repeat(60));
    console.error(error);

    // Exit with error code
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runApprovalPoller();
}

module.exports = {
  runApprovalPoller
};
