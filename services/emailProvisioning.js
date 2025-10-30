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

    console.log(`Checking domain authentication for: ${domain}`);

    // Check if domain is authenticated in SendGrid
    // This uses Domain Authentication (DNS-based), not Single Sender Verification
    // No verification email is sent - just checks if DNS records are configured
    let domainAuthenticated = false;
    let authenticatedDomainId = null;

    try {
      const [response, body] = await sgClient.request({
        method: "GET",
        url: "/v3/whitelabel/domains"
      });

      // Check if this domain is in the authenticated domains list
      if (body && Array.isArray(body)) {
        const authenticatedDomain = body.find(d =>
          d.domain === domain && d.valid === true
        );

        if (authenticatedDomain) {
          domainAuthenticated = true;
          authenticatedDomainId = authenticatedDomain.id;
          console.log(`✓ Domain ${domain} is authenticated (ID: ${authenticatedDomainId})`);
        } else {
          console.log(`⚠️ Domain ${domain} is NOT authenticated in SendGrid`);
        }
      }
    } catch (checkError) {
      console.error("Error checking domain authentication:", checkError);
      // Continue anyway - we'll provide DNS records below
    }

    if (domainAuthenticated) {
      // Domain is authenticated - can send immediately, no verification email needed!
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "emailConfig.provider": "sendgrid",
          "emailConfig.sendgrid.fromEmail": fromEmail,
          "emailConfig.sendgrid.fromName": fromName,
          "emailConfig.sendgrid.replyTo": replyTo || fromEmail,
          "emailConfig.sendgrid.domain": domain,
          "emailConfig.sendgrid.domainId": authenticatedDomainId,
          "emailConfig.sendgrid.domainVerified": true,
          "emailConfig.verificationStatus": "verified",
          "emailConfig.verifiedAt": new Date()
        }
      });

      console.log(`✓ Email configured successfully for ${fromEmail} (domain authenticated)`);

      return {
        success: true,
        verificationStatus: "verified",
        domainAuthenticated: true,
        message: `Email configured successfully! You can now send from ${fromEmail}`
      };
    } else {
      // Domain is NOT authenticated
      console.log(`⚠️ Domain ${domain} is not authenticated. Please authenticate the domain first.`);

      // Save partial configuration
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "emailConfig.provider": "sendgrid",
          "emailConfig.sendgrid.fromEmail": fromEmail,
          "emailConfig.sendgrid.fromName": fromName,
          "emailConfig.sendgrid.replyTo": replyTo || fromEmail,
          "emailConfig.sendgrid.domain": domain,
          "emailConfig.sendgrid.domainVerified": false,
          "emailConfig.verificationStatus": "pending_domain_authentication"
        }
      });

      return {
        success: false,
        verificationStatus: "pending_domain_authentication",
        domainAuthenticated: false,
        domain: domain,
        message: `Domain ${domain} is not authenticated in SendGrid. Please authenticate the domain first by adding DNS records. Use the /api/messaging/email/dns-records endpoint to get the required DNS records.`,
        nextStep: "Add DNS records to authenticate domain"
      };
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
    const domain = fromEmail.split("@")[1];

    console.log(`Checking domain authentication status for ${domain}`);

    try {
      // Check domain authentication (not single sender verification)
      const [response, body] = await sgClient.request({
        method: "GET",
        url: "/v3/whitelabel/domains"
      });

      if (body && Array.isArray(body)) {
        const authenticatedDomain = body.find(d =>
          d.domain === domain && d.valid === true
        );

        const isVerified = !!authenticatedDomain;

        // Update database if domain is authenticated
        if (isVerified && !company.emailConfig.sendgrid.domainVerified) {
          await Company.findByIdAndUpdate(companyId, {
            $set: {
              "emailConfig.sendgrid.domainVerified": true,
              "emailConfig.sendgrid.domainId": authenticatedDomain.id,
              "emailConfig.verificationStatus": "verified",
              "emailConfig.verifiedAt": new Date()
            }
          });

          console.log(`✓ Domain ${domain} authenticated for company ${companyId}`);
        }

        return {
          success: true,
          verified: isVerified,
          verificationStatus: isVerified ? "verified" : "pending_domain_authentication",
          verifiedAt: isVerified ? (company.emailConfig.verifiedAt || new Date()) : null,
          domain: domain,
          domainAuthenticated: isVerified,
          message: isVerified
            ? "Domain authenticated - email is verified and ready to use"
            : `Domain ${domain} is not authenticated. Please add DNS records to authenticate the domain.`
        };
      }

      // If body is not an array or empty
      return {
        success: false,
        verified: false,
        verificationStatus: "pending_domain_authentication",
        message: "Unable to check domain authentication status"
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
    const sgClient = getApiClient();

    console.log(`Fetching domain authentication DNS records for domain: ${domain}`);

    // Check if domain is already authenticated
    const [listResponse, listBody] = await sgClient.request({
      method: "GET",
      url: "/v3/whitelabel/domains"
    });

    let authenticatedDomain = null;
    if (listBody && Array.isArray(listBody)) {
      authenticatedDomain = listBody.find(d => d.domain === domain);
    }

    if (authenticatedDomain) {
      // Domain already exists - return its DNS records
      console.log(`✓ Found existing domain authentication for ${domain} (ID: ${authenticatedDomain.id})`);

      // Get detailed DNS records for this domain
      const [detailResponse, detailBody] = await sgClient.request({
        method: "GET",
        url: `/v3/whitelabel/domains/${authenticatedDomain.id}`
      });

      const dnsRecords = detailBody.dns || {};

      return {
        success: true,
        domain,
        authenticated: authenticatedDomain.valid === true,
        dnsRecords: {
          mail_cname: dnsRecords.mail_cname || {},
          dkim1: dnsRecords.dkim1 || {},
          dkim2: dnsRecords.dkim2 || {}
        },
        instructions: {
          status: authenticatedDomain.valid ? "✓ Domain is authenticated" : "⚠️ Domain not yet authenticated",
          next: authenticatedDomain.valid
            ? "Domain is ready to use. You can send emails immediately."
            : "Add the DNS records shown above to your domain's DNS settings, then wait 24-48 hours for verification.",
          note: "DNS changes can take up to 48 hours to propagate"
        }
      };
    }

    // Domain not set up yet - create it and return DNS records
    console.log(`Domain ${domain} not found in SendGrid. Creating domain authentication...`);

    try {
      const [createResponse, createBody] = await sgClient.request({
        method: "POST",
        url: "/v3/whitelabel/domains",
        body: {
          domain: domain,
          subdomain: "em", // SendGrid subdomain for sending (e.g., em.passau.com)
          default: false
        }
      });

      const dnsRecords = createBody.dns || {};

      return {
        success: true,
        domain,
        authenticated: false,
        newlyCreated: true,
        dnsRecords: {
          mail_cname: dnsRecords.mail_cname || {},
          dkim1: dnsRecords.dkim1 || {},
          dkim2: dnsRecords.dkim2 || {}
        },
        instructions: {
          status: "⚠️ Domain authentication created - DNS records must be added",
          next: "Add the CNAME records shown above to your domain's DNS settings (e.g., in your domain registrar or DNS provider like Cloudflare). Once added, SendGrid will automatically verify within 24-48 hours.",
          note: "DNS changes can take up to 48 hours to propagate"
        }
      };
    } catch (createError) {
      if (createError.response?.body?.errors) {
        throw new Error(`Failed to create domain authentication: ${JSON.stringify(createError.response.body.errors)}`);
      }
      throw createError;
    }
  } catch (error) {
    console.error("Error generating DNS records:", error);
    throw new Error(`Failed to generate DNS records: ${error.message}`);
  }
};

/**
 * Manually verify domain authentication
 * This is called when user clicks "Verify DNS" button
 * Checks if DNS records have been added and domain is now authenticated
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, verified, status }
 */
exports.verifyDomainManually = async (companyId) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.emailConfig?.sendgrid?.fromEmail) {
      throw new Error("No email configured. Please configure email first.");
    }

    const fromEmail = company.emailConfig.sendgrid.fromEmail;
    const domain = fromEmail.split("@")[1];

    console.log(`Manually verifying domain authentication for: ${domain}`);

    const sgClient = getApiClient();

    // Check domain authentication status
    const [response, body] = await sgClient.request({
      method: "GET",
      url: "/v3/whitelabel/domains"
    });

    if (body && Array.isArray(body)) {
      const authenticatedDomain = body.find(d => d.domain === domain);

      if (!authenticatedDomain) {
        // Domain not even set up in SendGrid yet
        return {
          success: false,
          verified: false,
          status: "not_configured",
          message: `Domain ${domain} not found in SendGrid. Please call /api/messaging/email/dns-records first to set up domain authentication.`
        };
      }

      const isVerified = authenticatedDomain.valid === true;

      if (isVerified) {
        // Domain is now verified! Update database
        await Company.findByIdAndUpdate(companyId, {
          $set: {
            "emailConfig.sendgrid.domainVerified": true,
            "emailConfig.sendgrid.domainId": authenticatedDomain.id,
            "emailConfig.verificationStatus": "verified",
            "emailConfig.verifiedAt": new Date(),
            "emailConfig.lastVerificationCheck": new Date()
          }
        });

        console.log(`✓ Domain ${domain} is now verified for company ${companyId}`);

        return {
          success: true,
          verified: true,
          status: "verified",
          domain: domain,
          message: `Success! Domain ${domain} is authenticated. You can now send emails from ${fromEmail}.`
        };
      } else {
        // Domain exists but not yet verified (DNS not propagated or incorrect)
        await Company.findByIdAndUpdate(companyId, {
          $set: {
            "emailConfig.lastVerificationCheck": new Date()
          }
        });

        console.log(`⚠️ Domain ${domain} not yet verified for company ${companyId}`);

        return {
          success: false,
          verified: false,
          status: "pending",
          domain: domain,
          message: `Domain ${domain} is not yet authenticated. Please ensure you've added the DNS records correctly. DNS changes can take 24-48 hours to propagate.`,
          nextStep: "Double-check the CNAME records in your DNS provider, or wait longer for DNS propagation"
        };
      }
    }

    return {
      success: false,
      verified: false,
      status: "error",
      message: "Unable to check domain authentication status"
    };
  } catch (error) {
    console.error("Error verifying domain:", error);
    throw new Error(`Failed to verify domain: ${error.message}`);
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
