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
exports.configureSender = async (companyId, fromEmail, fromName) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    console.log(`Configuring email sender for company ${companyId}: ${fromEmail}`);

    // Get existing senders array
    const existingSenders = company.emailConfig?.sendgrid?.senders || [];
    const existingSender = existingSenders.find(s => s.email === fromEmail);

    if (existingSender && existingSender.domainVerified) {
      return {
        success: true,
        alreadyConfigured: true,
        verificationStatus: "verified",
        sender: existingSender,
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
      const newSender = {
        email: fromEmail,
        name: fromName,
        domain: domain,
        domainId: authenticatedDomainId,
        domainVerified: true,
        verifiedAt: new Date(),
        isDefault: existingSenders.length === 0 // First sender is default
      };

      // Update senders array in memory
      let updatedSenders;
      if (existingSender) {
        // Replace existing sender
        updatedSenders = existingSenders.map(s =>
          s.email === fromEmail ? newSender : s
        );
      } else {
        // Add new sender
        updatedSenders = [...existingSenders, newSender];
      }

      // Save to database
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "emailConfig.provider": "sendgrid",
          "emailConfig.sendgrid.senders": updatedSenders
        }
      });

      console.log(`✓ Email configured successfully for ${fromEmail} (domain authenticated)`);

      return {
        success: true,
        verificationStatus: "verified",
        domainAuthenticated: true,
        sender: newSender,
        message: `Email configured successfully! You can now send from ${fromEmail}`
      };
    } else {
      // Domain is NOT authenticated
      console.log(`⚠️ Domain ${domain} is not authenticated. Please authenticate the domain first.`);

      // Save partial configuration
      const pendingSender = {
        email: fromEmail,
        name: fromName,
        domain: domain,
        domainVerified: false,
        isDefault: existingSenders.length === 0
      };

      // Update senders array in memory
      let updatedSenders;
      if (existingSender) {
        // Replace existing sender
        updatedSenders = existingSenders.map(s =>
          s.email === fromEmail ? pendingSender : s
        );
      } else {
        // Add new sender
        updatedSenders = [...existingSenders, pendingSender];
      }

      // Save to database
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "emailConfig.provider": "sendgrid",
          "emailConfig.sendgrid.senders": updatedSenders
        }
      });

      return {
        success: false,
        verificationStatus: "pending_domain_authentication",
        domainAuthenticated: false,
        domain: domain,
        sender: pendingSender,
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

    // Get senders array
    const senders = company.emailConfig?.sendgrid?.senders || [];

    if (senders.length === 0) {
      return {
        success: false,
        verified: false,
        error: "No email senders configured"
      };
    }

    const sgClient = getApiClient();

    // Get all unique domains from senders
    const uniqueDomains = [...new Set(senders.map(s => s.email.split("@")[1]))];

    console.log(`Checking domain authentication status for ${uniqueDomains.length} domain(s): ${uniqueDomains.join(", ")}`);

    try {
      // Get all authenticated domains from SendGrid
      const [response, body] = await sgClient.request({
        method: "GET",
        url: "/v3/whitelabel/domains"
      });

      if (!body || !Array.isArray(body)) {
        return {
          success: false,
          verified: false,
          verificationStatus: "pending_domain_authentication",
          message: "Unable to check domain authentication status"
        };
      }

      const authenticatedDomains = body.filter(d => d.valid === true);

      // Check each sender's domain
      const sendersWithStatus = senders.map(sender => {
        const domain = sender.email.split("@")[1];
        const authenticatedDomain = authenticatedDomains.find(d => d.domain === domain);
        const isVerified = !!authenticatedDomain;

        return {
          email: sender.email,
          name: sender.name,
          domain: domain,
          verified: isVerified,
          isDefault: sender.isDefault || false
        };
      });

      // Update database for any newly verified senders
      const updatedSenders = senders.map(sender => {
        const domain = sender.email.split("@")[1];
        const authenticatedDomain = authenticatedDomains.find(d => d.domain === domain);

        if (authenticatedDomain && !sender.domainVerified) {
          console.log(`✓ Domain ${domain} authenticated for sender ${sender.email}`);
          return {
            ...sender,
            domainVerified: true,
            domainId: authenticatedDomain.id,
            verifiedAt: sender.verifiedAt || new Date()
          };
        }

        return sender;
      });

      // Save updated senders to database
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "emailConfig.sendgrid.senders": updatedSenders,
          "emailConfig.verificationStatus": updatedSenders.every(s => s.domainVerified) ? "verified" : "pending_domain_authentication"
        }
      });

      // Calculate overall status
      const allVerified = sendersWithStatus.every(s => s.verified);
      const verifiedCount = sendersWithStatus.filter(s => s.verified).length;

      // Get primary domain (from first/default sender)
      const primaryDomain = sendersWithStatus.find(s => s.isDefault)?.domain || sendersWithStatus[0].domain;

      return {
        success: true,
        verified: allVerified,
        verificationStatus: allVerified ? "verified" : "pending_domain_authentication",
        domain: primaryDomain,
        domains: uniqueDomains,
        domainAuthenticated: allVerified,
        senders: sendersWithStatus,
        message: allVerified
          ? `Domain authenticated - ${verifiedCount} sender(s) ready to use`
          : `${verifiedCount}/${sendersWithStatus.length} sender(s) verified. Some domains need DNS authentication.`
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
exports.getDnsRecords = async (companyId, specificDomain = null) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    // Get senders array
    const senders = company.emailConfig?.sendgrid?.senders || [];

    if (senders.length === 0) {
      throw new Error("No email senders configured. Configure sender email first.");
    }

    const sgClient = getApiClient();

    // Get all unique domains from senders
    const uniqueDomains = [...new Set(senders.map(s => s.email.split("@")[1]))];

    // If specific domain requested, validate it exists in senders
    let targetDomains = uniqueDomains;
    if (specificDomain) {
      if (!uniqueDomains.includes(specificDomain)) {
        throw new Error(`Domain ${specificDomain} not found in configured senders. Available domains: ${uniqueDomains.join(", ")}`);
      }
      targetDomains = [specificDomain];
      console.log(`Fetching DNS records for specific domain: ${specificDomain}`);
    } else {
      console.log(`Fetching DNS records for all domains: ${uniqueDomains.join(", ")}`);
    }

    // Get all authenticated domains from SendGrid
    const [listResponse, listBody] = await sgClient.request({
      method: "GET",
      url: "/v3/whitelabel/domains"
    });

    const allAuthenticatedDomains = (listBody && Array.isArray(listBody)) ? listBody : [];

    // Process each target domain
    const domainResults = [];

    for (const domain of targetDomains) {
      let authenticatedDomain = allAuthenticatedDomains.find(d => d.domain === domain);

      if (authenticatedDomain) {
        // Domain already exists - get its DNS records
        console.log(`✓ Found existing domain authentication for ${domain} (ID: ${authenticatedDomain.id})`);

        const [detailResponse, detailBody] = await sgClient.request({
          method: "GET",
          url: `/v3/whitelabel/domains/${authenticatedDomain.id}`
        });

        const dnsRecords = detailBody.dns || {};

        domainResults.push({
          domain,
          authenticated: authenticatedDomain.valid === true,
          dnsRecords: {
            mail_cname: dnsRecords.mail_cname || {},
            dkim1: dnsRecords.dkim1 || {},
            dkim2: dnsRecords.dkim2 || {}
          },
          instructions: authenticatedDomain.valid
            ? "Domain is authenticated and ready to use."
            : "Add the DNS records shown above to your domain's DNS settings, then wait 24-48 hours for verification."
        });
      } else {
        // Domain not set up yet - create it
        console.log(`Domain ${domain} not found in SendGrid. Creating domain authentication...`);

        try {
          const [createResponse, createBody] = await sgClient.request({
            method: "POST",
            url: "/v3/whitelabel/domains",
            body: {
              domain: domain,
              subdomain: "em",
              default: false
            }
          });

          const dnsRecords = createBody.dns || {};

          domainResults.push({
            domain,
            authenticated: false,
            newlyCreated: true,
            dnsRecords: {
              mail_cname: dnsRecords.mail_cname || {},
              dkim1: dnsRecords.dkim1 || {},
              dkim2: dnsRecords.dkim2 || {}
            },
            instructions: "Domain authentication created. Add the CNAME records shown above to your DNS provider (Cloudflare, GoDaddy, etc.), then wait 24-48 hours for verification."
          });
        } catch (createError) {
          console.error(`Error creating domain authentication for ${domain}:`, createError);
          domainResults.push({
            domain,
            error: `Failed to create domain authentication: ${createError.message}`,
            authenticated: false
          });
        }
      }
    }

    // Return single domain result if specific domain requested
    if (specificDomain) {
      return {
        success: true,
        ...domainResults[0]
      };
    }

    // Return all domains
    return {
      success: true,
      domains: domainResults,
      totalDomains: domainResults.length,
      message: `DNS records for ${domainResults.length} domain(s)`
    };
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

    // Get senders array
    const senders = company.emailConfig?.sendgrid?.senders || [];

    if (senders.length === 0) {
      throw new Error("No email configured. Please configure email first.");
    }

    // Get all unique domains from senders
    const uniqueDomains = [...new Set(senders.map(s => s.domain))];

    console.log(`Manually verifying domain authentication for: ${uniqueDomains.join(", ")}`);

    const sgClient = getApiClient();

    // Check domain authentication status
    const [response, body] = await sgClient.request({
      method: "GET",
      url: "/v3/whitelabel/domains"
    });

    if (body && Array.isArray(body)) {
      const authenticatedDomains = body.filter(d => d.valid === true);

      // Update all senders based on their domain authentication
      const updatedSenders = senders.map(sender => {
        const authenticatedDomain = authenticatedDomains.find(d => d.domain === sender.domain);

        if (authenticatedDomain) {
          return {
            ...sender,
            domainVerified: true,
            domainId: authenticatedDomain.id,
            verifiedAt: sender.verifiedAt || new Date()
          };
        }

        return sender;
      });

      const verifiedSendersCount = updatedSenders.filter(s => s.domainVerified).length;
      const totalSendersCount = updatedSenders.length;

      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "emailConfig.sendgrid.senders": updatedSenders,
          "emailConfig.lastVerificationCheck": new Date()
        }
      });

      if (verifiedSendersCount > 0) {
        console.log(`✓ ${verifiedSendersCount} sender(s) verified for company ${companyId}`);

        const verifiedSenders = updatedSenders.filter(s => s.domainVerified).map(s => s.email);

        return {
          success: true,
          verified: verifiedSendersCount === totalSendersCount,
          status: verifiedSendersCount === totalSendersCount ? "verified" : "partial",
          domain: uniqueDomains[0],
          domains: uniqueDomains,
          verifiedSenders: verifiedSenders,
          message: verifiedSendersCount === totalSendersCount
            ? `Success! All domains authenticated. ${verifiedSendersCount} sender(s) ready to use.`
            : `${verifiedSendersCount}/${totalSendersCount} sender(s) verified. Some domains still need DNS authentication.`
        };
      } else {
        // No domains verified yet
        console.log(`⚠️ No domains verified yet for company ${companyId}`);

        return {
          success: false,
          verified: false,
          status: "pending",
          domain: uniqueDomains[0],
          domains: uniqueDomains,
          message: `No domains authenticated yet. Please ensure you've added the DNS records correctly. DNS changes can take 24-48 hours to propagate.`,
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

    // Get senders array
    const senders = company.emailConfig?.sendgrid?.senders || [];

    if (senders.length === 0) {
      throw new Error("No email configured");
    }

    // Get default sender or first sender
    const defaultSender = senders.find(s => s.isDefault) || senders[0];

    if (!defaultSender.domainVerified) {
      throw new Error("Email not verified. Please verify domain authentication first.");
    }

    const fromEmail = defaultSender.email;
    const fromName = defaultSender.name;
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
