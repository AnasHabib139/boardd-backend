"use strict";

/**
 * Email Provisioning Service
 *
 * Handles email configuration using OUR SendGrid account
 * Companies provide their sender email, we handle verification and sending
 * Companies never see "SendGrid" - they see "Email Configuration"
 *
 * Functions:
 * - Configure sender email (add as verified sender in SendGrid)
 * - Send verification email
 * - Check verification status
 * - Generate DNS records for inbound email
 * - Test email configuration
 */

const { getApiClient, getMailClient } = require("../config/sendgrid");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");

/**
 * Configure sender email for a company
 * Adds the email as a verified sender in our SendGrid account
 *
 * @param {String} companyId - Company ID
 * @param {String} fromEmail - Sender email address (e.g., support@company.com)
 * @param {String} fromName - Sender name (e.g., "Company Support")
 * @param {String} replyTo - Optional reply-to address
 * @returns {Promise<Object>} { success, verificationPending }
 */
exports.configureSender = async (companyId, fromEmail, fromName, replyTo = null) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    console.log(`Configuring email sender for company ${companyId}: ${fromEmail}`);

    // Check if already configured
    if (company.emailConfig?.sendgrid?.fromEmail === fromEmail &&
        company.emailConfig?.sendgrid?.domainVerified) {
      return {
        success: true,
        alreadyConfigured: true,
        verificationStatus: "verified",
        message: "Email already configured and verified"
      };
    }

    const sgClient = getApiClient();

    // Extract domain from email
    const domain = fromEmail.split("@")[1];

    // Create or update verified sender in SendGrid
    // SendGrid Verified Sender API
    const verifiedSenderRequest = {
      nickname: `${company.name} - ${fromEmail}`,
      from_email: fromEmail,
      from_name: fromName,
      reply_to: replyTo || fromEmail,
      address: company.address || "123 Main St",
      city: company.city || "San Francisco",
      state: company.state || "CA",
      zip: company.zip || "94102",
      country: company.country || "USA"
    };

    try {
      const [response, body] = await sgClient.request({
        method: "POST",
        url: "/v3/verified_senders",
        body: verifiedSenderRequest
      });

      console.log(`✓ Verified sender created in SendGrid, verification email sent to ${fromEmail}`);

      // Update company database
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "emailConfig.provider": "sendgrid",
          "emailConfig.sendgrid.fromEmail": fromEmail,
          "emailConfig.sendgrid.fromName": fromName,
          "emailConfig.sendgrid.replyTo": replyTo || fromEmail,
          "emailConfig.sendgrid.domainVerified": false, // Not verified yet
          "emailConfig.verificationStatus": "pending",
          "emailConfig.verifiedAt": null
        }
      });

      return {
        success: true,
        verificationPending: true,
        verificationStatus: "pending",
        message: `Verification email sent to ${fromEmail}. Please check inbox and click the verification link.`
      };
    } catch (sgError) {
      // If sender already exists, try to resend verification
      if (sgError.response?.body?.errors?.[0]?.message?.includes("already exists")) {
        console.log("Sender already exists, attempting to resend verification");

        // Update database anyway
        await Company.findByIdAndUpdate(companyId, {
          $set: {
            "emailConfig.provider": "sendgrid",
            "emailConfig.sendgrid.fromEmail": fromEmail,
            "emailConfig.sendgrid.fromName": fromName,
            "emailConfig.sendgrid.replyTo": replyTo || fromEmail,
            "emailConfig.verificationStatus": "pending"
          }
        });

        return {
          success: true,
          alreadyExists: true,
          verificationStatus: "pending",
          message: "Sender already exists in SendGrid. Check verification status."
        };
      }

      throw sgError;
    }
  } catch (error) {
    console.error("Error configuring email sender:", error);
    throw new Error(`Failed to configure email: ${error.message}`);
  }
};

/**
 * Check email verification status
 * Polls SendGrid to see if verification link was clicked
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, verified, verificationStatus }
 */
exports.checkVerificationStatus = async (companyId) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.emailConfig?.sendgrid?.fromEmail) {
      return {
        success: false,
        error: "No email configured"
      };
    }

    // If already verified in our DB, return that
    if (company.emailConfig.sendgrid.domainVerified) {
      return {
        success: true,
        verified: true,
        verificationStatus: "verified",
        verifiedAt: company.emailConfig.verifiedAt
      };
    }

    const sgClient = getApiClient();
    const fromEmail = company.emailConfig.sendgrid.fromEmail;

    console.log(`Checking verification status for ${fromEmail}`);

    try {
      // Get list of verified senders
      const [response, body] = await sgClient.request({
        method: "GET",
        url: "/v3/verified_senders"
      });

      const verifiedSenders = body.results || [];

      // Find our sender
      const sender = verifiedSenders.find(s =>
        s.from_email.toLowerCase() === fromEmail.toLowerCase()
      );

      if (!sender) {
        return {
          success: true,
          verified: false,
          verificationStatus: "pending",
          message: "Verification email sent. Waiting for confirmation."
        };
      }

      const isVerified = sender.verified?.status === true;

      // Update database if verified
      if (isVerified && !company.emailConfig.sendgrid.domainVerified) {
        await Company.findByIdAndUpdate(companyId, {
          $set: {
            "emailConfig.sendgrid.domainVerified": true,
            "emailConfig.verificationStatus": "verified",
            "emailConfig.verifiedAt": new Date()
          }
        });

        console.log(`✓ Email ${fromEmail} verified for company ${companyId}`);
      }

      return {
        success: true,
        verified: isVerified,
        verificationStatus: isVerified ? "verified" : "pending",
        verifiedAt: isVerified ? (company.emailConfig.verifiedAt || new Date()) : null,
        message: isVerified
          ? "Email verified and ready to use"
          : "Verification pending. Please check email and click verification link."
      };
    } catch (sgError) {
      console.error("Error checking SendGrid verification:", sgError);
      throw sgError;
    }
  } catch (error) {
    console.error("Error checking verification status:", error);
    throw new Error(`Failed to check verification status: ${error.message}`);
  }
};

/**
 * Generate DNS records for inbound email (MX, SPF, DKIM)
 * These records allow the company to receive email replies
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, dnsRecords }
 */
exports.getDnsRecords = async (companyId) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.emailConfig?.sendgrid?.fromEmail) {
      throw new Error("No email configured. Configure sender email first.");
    }

    const fromEmail = company.emailConfig.sendgrid.fromEmail;
    const domain = fromEmail.split("@")[1];

    console.log(`Generating DNS records for domain: ${domain}`);

    // Generate DNS records
    // These are SendGrid's inbound parse MX records
    const mxRecords = [
      { priority: 10, value: "mx.sendgrid.net" }
    ];

    // SPF record to allow SendGrid to send on behalf of domain
    const spfRecord = "v=spf1 include:sendgrid.net ~all";

    // DKIM - would need to be generated per domain in SendGrid
    // For now, provide placeholder
    const dkimRecord = {
      note: "DKIM records must be generated in SendGrid domain authentication",
      action: "Contact support to set up domain authentication for better deliverability"
    };

    // Save to database for reference
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "emailConfig.dnsRecords": {
          mx: mxRecords.map(r => `${r.priority} ${r.value}`),
          spf: spfRecord,
          dkim: dkimRecord.note
        }
      }
    });

    return {
      success: true,
      domain,
      dnsRecords: {
        mx: mxRecords.map(r => ({
          type: "MX",
          host: `chat.${domain}`, // Subdomain for inbound emails
          priority: r.priority,
          value: r.value,
          ttl: 3600
        })),
        spf: {
          type: "TXT",
          host: "@",
          value: spfRecord,
          ttl: 3600
        },
        dkim: dkimRecord
      },
      instructions: {
        inbound: `To receive email replies, add the MX record for subdomain chat.${domain} or configure email forwarding`,
        sending: `To improve deliverability, add the SPF record. DKIM setup requires domain authentication in SendGrid.`,
        note: "DNS changes can take up to 48 hours to propagate"
      }
    };
  } catch (error) {
    console.error("Error generating DNS records:", error);
    throw new Error(`Failed to generate DNS records: ${error.message}`);
  }
};

/**
 * Test email configuration by sending a test email
 *
 * @param {String} companyId - Company ID
 * @param {String} testRecipient - Optional test recipient (defaults to company's fromEmail)
 * @returns {Promise<Object>} { success, messageId }
 */
exports.testEmailConfiguration = async (companyId, testRecipient = null) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.emailConfig?.sendgrid?.fromEmail) {
      throw new Error("No email configured");
    }

    if (!company.emailConfig.sendgrid.domainVerified) {
      throw new Error("Email not verified. Please verify email first by clicking the link sent to your inbox.");
    }

    const fromEmail = company.emailConfig.sendgrid.fromEmail;
    const fromName = company.emailConfig.sendgrid.fromName;
    const recipient = testRecipient || fromEmail; // Send to self if no recipient specified

    console.log(`Sending test email for company ${companyId} from ${fromEmail} to ${recipient}`);

    const emailProvider = require("../providers/email.sendgrid");

    const result = await emailProvider.sendEmail({
      companyId,
      to: recipient,
      subject: "Test Email - Your Messaging Configuration",
      htmlContent: `
        <h2>Email Configuration Test</h2>
        <p>Congratulations! Your email messaging is configured correctly.</p>
        <p><strong>Sender:</strong> ${fromName} &lt;${fromEmail}&gt;</p>
        <p><strong>Provider:</strong> Managed Email Service</p>
        <p>You can now send emails to clients from your chat interface.</p>
        <hr>
        <p style="color: #666; font-size: 12px;">This is a test email sent from your Boardd messaging configuration.</p>
      `,
      textContent: `Email Configuration Test\n\nCongratulations! Your email messaging is configured correctly.\n\nSender: ${fromName} <${fromEmail}>\nProvider: Managed Email Service\n\nYou can now send emails to clients from your chat interface.`,
      conversationId: null,
      messageId: null
    });

    if (result.success) {
      console.log(`✓ Test email sent successfully: ${result.providerMessageId}`);

      return {
        success: true,
        messageId: result.providerMessageId,
        sentTo: recipient,
        sentFrom: fromEmail,
        message: "Test email sent successfully"
      };
    } else {
      throw new Error(result.error || "Email send failed");
    }
  } catch (error) {
    console.error("Error sending test email:", error);
    throw new Error(`Failed to send test email: ${error.message}`);
  }
};
