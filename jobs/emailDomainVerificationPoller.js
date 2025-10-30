"use strict";

/**
 * Email Domain Verification Poller
 *
 * Automatically checks domain authentication status for companies
 * with pending email verification every 6 hours.
 *
 * Run this job via cron or schedule it in your cron jobs manager.
 *
 * Usage:
 *   node jobs/emailDomainVerificationPoller.js
 *
 * Or add to cron:
 *   0 */6 * * * node /path/to/jobs/emailDomainVerificationPoller.js
 */

const { model: mongooseModel } = require("mongoose");
const { getApiClient } = require("../config/sendgrid");
const Company = mongooseModel("Company");

/**
 * Poll all companies with pending email domain verification
 * and check if their domains are now authenticated
 */
async function pollDomainVerifications() {
  try {
    console.log("========================================");
    console.log("Starting email domain verification polling...");
    console.log("Time:", new Date().toISOString());

    // Find companies with pending domain authentication
    const pendingCompanies = await Company.find({
      "emailConfig.sendgrid.fromEmail": { $exists: true },
      "emailConfig.sendgrid.domainVerified": false,
      "emailConfig.verificationStatus": {
        $in: ["pending_domain_authentication", "pending"]
      }
    }).select("_id name emailConfig");

    console.log(`Found ${pendingCompanies.length} companies with pending domain verification`);

    if (pendingCompanies.length === 0) {
      console.log("No pending verifications to check. Exiting.");
      return {
        success: true,
        checked: 0,
        verified: 0,
        stillPending: 0
      };
    }

    const sgClient = getApiClient();

    // Get all authenticated domains from SendGrid
    const [response, body] = await sgClient.request({
      method: "GET",
      url: "/v3/whitelabel/domains"
    });

    if (!body || !Array.isArray(body)) {
      console.error("Failed to fetch authenticated domains from SendGrid");
      return {
        success: false,
        error: "Failed to fetch domains from SendGrid"
      };
    }

    const authenticatedDomains = body.filter(d => d.valid === true);
    console.log(`Found ${authenticatedDomains.length} authenticated domains in SendGrid`);

    let verified = 0;
    let stillPending = 0;

    // Check each pending company
    for (const company of pendingCompanies) {
      try {
        const fromEmail = company.emailConfig.sendgrid.fromEmail;
        const domain = fromEmail.split("@")[1];

        console.log(`\nChecking ${company.name} (${company._id}): ${domain}`);

        // Check if this domain is in the authenticated list
        const authenticatedDomain = authenticatedDomains.find(d => d.domain === domain);

        if (authenticatedDomain) {
          // Domain is now verified!
          console.log(`  ✓ Domain ${domain} is now authenticated!`);

          await Company.findByIdAndUpdate(company._id, {
            $set: {
              "emailConfig.sendgrid.domainVerified": true,
              "emailConfig.sendgrid.domainId": authenticatedDomain.id,
              "emailConfig.verificationStatus": "verified",
              "emailConfig.verifiedAt": new Date(),
              "emailConfig.lastVerificationCheck": new Date()
            }
          });

          verified++;

          // TODO: Send notification to company admin that email is ready
          console.log(`  ✓ Updated company ${company.name} - email is now ready to use`);
        } else {
          // Still not verified
          console.log(`  ⚠️ Domain ${domain} still not authenticated`);

          await Company.findByIdAndUpdate(company._id, {
            $set: {
              "emailConfig.lastVerificationCheck": new Date()
            }
          });

          stillPending++;
        }
      } catch (companyError) {
        console.error(`Error checking company ${company._id}:`, companyError.message);
        // Continue with next company
      }
    }

    console.log("\n========================================");
    console.log("Polling complete");
    console.log(`  Checked: ${pendingCompanies.length}`);
    console.log(`  Newly verified: ${verified}`);
    console.log(`  Still pending: ${stillPending}`);
    console.log("========================================\n");

    return {
      success: true,
      checked: pendingCompanies.length,
      verified,
      stillPending
    };
  } catch (error) {
    console.error("Error in domain verification polling:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main execution
 * Can be run standalone or imported as a module
 */
async function main() {
  try {
    // Connect to database
    const DB_CONNECT = require("../config/dbConnect");
    await DB_CONNECT();
    console.log("✓ Database connected");

    // Run polling
    const result = await pollDomainVerifications();

    if (result.success) {
      console.log("✓ Polling completed successfully");
      process.exit(0);
    } else {
      console.error("✗ Polling failed:", result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Run if executed directly (not imported)
if (require.main === module) {
  main();
}

// Export for use as a module
module.exports = {
  pollDomainVerifications
};
