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
 * @param {String} inboundSubdomain - Optional inbound subdomain for receiving emails (e.g., "inbound.company.com")
 * @returns {Promise<Object>} { success, verificationPending }
 */
exports.configureSender = async (companyId, fromEmail, fromName, replyTo, inboundSubdomain) => {
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
      const updateFields = {
        "emailConfig.provider": "sendgrid",
        "emailConfig.sendgrid.senders": updatedSenders
      };

      // Save replyTo if provided
      if (replyTo) {
        updateFields["emailConfig.sendgrid.replyTo"] = replyTo;
      }

      // Save inboundSubdomain if provided
      if (inboundSubdomain) {
        updateFields["emailConfig.sendgrid.inboundSubdomain"] = inboundSubdomain;
      }

      await Company.findByIdAndUpdate(companyId, {
        $set: updateFields
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
      const updateFields = {
        "emailConfig.provider": "sendgrid",
        "emailConfig.sendgrid.senders": updatedSenders
      };

      // Save replyTo if provided
      if (replyTo) {
        updateFields["emailConfig.sendgrid.replyTo"] = replyTo;
      }

      // Save inboundSubdomain if provided
      if (inboundSubdomain) {
        updateFields["emailConfig.sendgrid.inboundSubdomain"] = inboundSubdomain;
      }

      await Company.findByIdAndUpdate(companyId, {
        $set: updateFields
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
 * Register inbound parse webhook with SendGrid
 * This tells SendGrid to forward emails from inboundSubdomain to our webhook
 *
 * Step-by-step:
 * 1. Company adds MX record: inbound.company.com → mx.sendgrid.net (Priority 10)
 * 2. Company calls this API to register the subdomain with SendGrid
 * 3. SendGrid forwards all emails to our webhook URL
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, parseId, status, warning }
 */
exports.registerInboundParse = async (companyId) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    const inboundSubdomain = company.emailConfig?.sendgrid?.inboundSubdomain;

    if (!inboundSubdomain) {
      throw new Error("No inbound subdomain configured. Please configure email first.");
    }

    // Check if already registered
    if (company.emailConfig?.sendgrid?.inboundParseId) {
      console.log(`Inbound parse already registered for ${inboundSubdomain}`);
      return {
        success: true,
        alreadyRegistered: true,
        parseId: company.emailConfig.sendgrid.inboundParseId,
        inboundSubdomain,
        message: "Inbound email is already configured"
      };
    }

    const sgClient = getApiClient();

    // Webhook URL where SendGrid will POST inbound emails
    const webhookUrl = process.env.BACKEND_URL
      ? `${process.env.BACKEND_URL}/api/webhooks/email/sendgrid`
      : "https://boarddd.ddns.net/api/webhooks/email/sendgrid";

    console.log(`Registering inbound parse: ${inboundSubdomain} → ${webhookUrl}`);

    // Register inbound parse with SendGrid
    const [response, body] = await sgClient.request({
      method: "POST",
      url: "/v3/user/webhooks/parse/settings",
      body: {
        hostname: inboundSubdomain,
        url: webhookUrl,
        spam_check: true,
        send_raw: false
      }
    });

    console.log(`✓ Inbound parse registered successfully:`, body);

    // Save inboundParseId to company
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "emailConfig.sendgrid.inboundParseId": body.id || "configured"
      }
    });

    // Verify MX record (optional - doesn't block registration)
    const mxWarning = await checkMxRecord(inboundSubdomain);

    return {
      success: true,
      parseId: body.id || "configured",
      inboundSubdomain,
      webhookUrl,
      message: "Inbound email configured successfully! Clients can now reply to emails.",
      mxRecordStatus: mxWarning ? "not_verified" : "verified",
      warning: mxWarning
    };
  } catch (error) {
    console.error("Error registering inbound parse:", error);

    // SendGrid returns 400 if subdomain already registered (by another company or duplicate)
    if (error.response?.statusCode === 400) {
      const errorBody = error.response?.body;

      // Check if it's a duplicate registration error
      if (errorBody?.errors?.[0]?.message?.includes("already exists")) {
        throw new Error(
          `The subdomain "${error.response.body.errors[0].field}" is already registered in SendGrid. ` +
          `Please use a different inbound subdomain or contact support if you believe this is an error.`
        );
      }
    }

    throw new Error(`Failed to register inbound email: ${error.message}`);
  }
};

/**
 * Check MX record for inbound subdomain using DNS lookup
 * Returns warning message if MX record not found or incorrect
 *
 * @param {String} hostname - Inbound subdomain (e.g., "inbound.company.com")
 * @returns {Promise<String|null>} Warning message or null if OK
 */
async function checkMxRecord(hostname) {
  try {
    const dns = require("dns").promises;

    const mxRecords = await dns.resolveMx(hostname);

    if (!mxRecords || mxRecords.length === 0) {
      return `⚠️ MX record not found for ${hostname}. Add MX record: ${hostname} → mx.sendgrid.net (Priority 10)`;
    }

    // Check if mx.sendgrid.net is in the MX records
    const hasSendGridMx = mxRecords.some(record =>
      record.exchange.toLowerCase().includes("sendgrid")
    );

    if (!hasSendGridMx) {
      return `⚠️ MX record found but doesn't point to SendGrid. Please add: ${hostname} → mx.sendgrid.net (Priority 10)`;
    }

    console.log(`✓ MX record verified for ${hostname}:`, mxRecords);
    return null; // All good
  } catch (error) {
    console.warn(`Could not verify MX record for ${hostname}:`, error.message);
    return `⚠️ Could not verify MX record. Please ensure you added: ${hostname} → mx.sendgrid.net (Priority 10)`;
  }
}

/**
 * Verify inbound MX record via DNS lookup
 * Checks if MX record is properly configured
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, verified, mxRecords }
 */
exports.verifyInboundMxRecord = async (companyId) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    const inboundSubdomain = company.emailConfig?.sendgrid?.inboundSubdomain;

    if (!inboundSubdomain) {
      throw new Error("No inbound subdomain configured");
    }

    const dns = require("dns").promises;

    try {
      const mxRecords = await dns.resolveMx(inboundSubdomain);

      // Check if mx.sendgrid.net is in the records
      const hasSendGridMx = mxRecords.some(record =>
        record.exchange.toLowerCase().includes("sendgrid")
      );

      return {
        success: true,
        verified: hasSendGridMx,
        inboundSubdomain,
        mxRecords: mxRecords.map(r => ({
          exchange: r.exchange,
          priority: r.priority
        })),
        message: hasSendGridMx
          ? "MX record verified! Inbound email is ready."
          : "MX record found but doesn't point to SendGrid. Please update it.",
        expectedRecord: {
          type: "MX",
          host: inboundSubdomain,
          value: "mx.sendgrid.net",
          priority: 10
        }
      };
    } catch (dnsError) {
      return {
        success: true,
        verified: false,
        inboundSubdomain,
        mxRecords: [],
        message: "MX record not found. Please add it to your DNS settings.",
        error: dnsError.code,
        expectedRecord: {
          type: "MX",
          host: inboundSubdomain,
          value: "mx.sendgrid.net",
          priority: 10
        }
      };
    }
  } catch (error) {
    console.error("Error verifying MX record:", error);
    throw new Error(`Failed to verify MX record: ${error.message}`);
  }
};

/**
 * Get inbound email configuration status
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, configured, status, details }
 */
exports.getInboundStatus = async (companyId) => {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    const inboundSubdomain = company.emailConfig?.sendgrid?.inboundSubdomain;
    const inboundParseId = company.emailConfig?.sendgrid?.inboundParseId;

    if (!inboundSubdomain) {
      return {
        success: true,
        configured: false,
        status: "not_configured",
        message: "Inbound email not configured. Please configure email first.",
        nextStep: "Add inboundSubdomain when calling POST /api/messaging/email/configure"
      };
    }

    if (!inboundParseId) {
      // Subdomain configured but not registered with SendGrid
      return {
        success: true,
        configured: false,
        status: "pending_registration",
        inboundSubdomain,
        message: "Inbound subdomain configured but not registered with SendGrid",
        nextStep: "Call POST /api/messaging/email/register-inbound to activate"
      };
    }

    // Check MX record
    const dns = require("dns").promises;
    let mxVerified = false;
    let mxRecords = [];

    try {
      const records = await dns.resolveMx(inboundSubdomain);
      mxRecords = records.map(r => ({ exchange: r.exchange, priority: r.priority }));
      mxVerified = records.some(r => r.exchange.toLowerCase().includes("sendgrid"));
    } catch (err) {
      console.log(`MX record not found for ${inboundSubdomain}`);
    }

    return {
      success: true,
      configured: true,
      status: mxVerified ? "active" : "pending_mx_record",
      inboundSubdomain,
      parseId: inboundParseId,
      webhookUrl: process.env.BACKEND_URL
        ? `${process.env.BACKEND_URL}/api/webhooks/email/sendgrid`
        : "https://boarddd.ddns.net/api/webhooks/email/sendgrid",
      mxRecordVerified: mxVerified,
      mxRecords,
      message: mxVerified
        ? "Inbound email is fully configured and ready!"
        : "Inbound registered but MX record not detected. Add MX record to complete setup.",
      expectedMxRecord: {
        type: "MX",
        host: inboundSubdomain,
        value: "mx.sendgrid.net",
        priority: 10
      }
    };
  } catch (error) {
    console.error("Error getting inbound status:", error);
    throw new Error(`Failed to get inbound status: ${error.message}`);
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
        const inboundSubdomain = company.emailConfig?.sendgrid?.inboundSubdomain;

        domainResults.push({
          domain,
          authenticated: authenticatedDomain.valid === true,
          inboundSubdomain: inboundSubdomain || `inbound.${domain}`,
          dnsRecords: {
            sending: {
              description: "CNAME records for SENDING emails (domain authentication)",
              records: [
                {
                  type: "CNAME",
                  host: dnsRecords.mail_cname?.host || "",
                  value: dnsRecords.mail_cname?.data || "",
                  purpose: "Mail server pointer",
                  status: dnsRecords.mail_cname?.valid ? "verified" : "pending"
                },
                {
                  type: "CNAME",
                  host: dnsRecords.dkim1?.host || "",
                  value: dnsRecords.dkim1?.data || "",
                  purpose: "DKIM authentication key 1",
                  status: dnsRecords.dkim1?.valid ? "verified" : "pending"
                },
                {
                  type: "CNAME",
                  host: dnsRecords.dkim2?.host || "",
                  value: dnsRecords.dkim2?.data || "",
                  purpose: "DKIM authentication key 2",
                  status: dnsRecords.dkim2?.valid ? "verified" : "pending"
                }
              ]
            },
            receiving: {
              description: "MX record for RECEIVING email replies via webhook",
              records: [
                {
                  type: "MX",
                  host: inboundSubdomain || `inbound.${domain}`,
                  value: "mx.sendgrid.net",
                  priority: 10,
                  purpose: "Route inbound emails to SendGrid for parsing",
                  status: company.emailConfig?.sendgrid?.inboundParseId ? "configured" : "pending"
                }
              ],
              note: "MX record enables clients to reply to emails and have responses routed to your webhook"
            }
          },
          instructions: authenticatedDomain.valid
            ? ["Domain is authenticated and ready to use."]
            : [
                "1. Add all 3 CNAME records for sending emails",
                "2. Add the MX record for receiving email replies",
                "3. Wait 24-48 hours for DNS propagation",
                "4. Call /api/messaging/email/verify-domain to verify"
              ]
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
          const inboundSubdomain = company.emailConfig?.sendgrid?.inboundSubdomain;

          domainResults.push({
            domain,
            authenticated: false,
            newlyCreated: true,
            inboundSubdomain: inboundSubdomain || `inbound.${domain}`,
            dnsRecords: {
              sending: {
                description: "CNAME records for SENDING emails (domain authentication)",
                records: [
                  {
                    type: "CNAME",
                    host: dnsRecords.mail_cname?.host || "",
                    value: dnsRecords.mail_cname?.data || "",
                    purpose: "Mail server pointer",
                    status: "pending"
                  },
                  {
                    type: "CNAME",
                    host: dnsRecords.dkim1?.host || "",
                    value: dnsRecords.dkim1?.data || "",
                    purpose: "DKIM authentication key 1",
                    status: "pending"
                  },
                  {
                    type: "CNAME",
                    host: dnsRecords.dkim2?.host || "",
                    value: dnsRecords.dkim2?.data || "",
                    purpose: "DKIM authentication key 2",
                    status: "pending"
                  }
                ]
              },
              receiving: {
                description: "MX record for RECEIVING email replies via webhook",
                records: [
                  {
                    type: "MX",
                    host: inboundSubdomain || `inbound.${domain}`,
                    value: "mx.sendgrid.net",
                    priority: 10,
                    purpose: "Route inbound emails to SendGrid for parsing",
                    status: company.emailConfig?.sendgrid?.inboundParseId ? "configured" : "pending"
                  }
                ],
                note: "MX record enables clients to reply to emails and have responses routed to your webhook"
              }
            },
            instructions: [
              "1. Add all 3 CNAME records for sending emails",
              "2. Add the MX record for receiving email replies",
              "3. Wait 24-48 hours for DNS propagation",
              "4. Call /api/messaging/email/verify-domain to verify"
            ]
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
        <p style="color: #666; font-size: 12px;">This is a test email sent from your Boarddd messaging configuration.</p>
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
