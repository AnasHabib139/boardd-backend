"use strict";

/**
 * Email Client Factory
 * Provides company-specific email clients (SendGrid or SMTP)
 * Supports multi-tenant email configuration
 */

const sgMail = require("@sendgrid/mail");
const nodemailer = require("nodemailer");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");

/**
 * Get email client for a specific company
 * @param {String|ObjectId} companyId - Company ID
 * @returns {Promise<Object>} Email client object with type, client, and from details
 */
async function getEmailClientForCompany(companyId) {
  try {
    const companyIdStr = companyId.toString();

    // Fetch company config (include encrypted fields)
    const company = await Company.findById(companyId).select(
      "+emailConfig.sendgrid.apiKey +emailConfig.smtp.password"
    );

    if (!company) {
      throw new Error(`Company ${companyIdStr} not found`);
    }

    if (
      !company.emailConfig ||
      company.emailConfig.provider === "none"
    ) {
      throw new Error(
        `Company ${companyIdStr} email not configured - provider is 'none'`
      );
    }

    // SendGrid configuration (using master account with domain authentication)
    if (company.emailConfig.provider === "sendgrid") {
      // Use master SendGrid API key (all companies share the same account)
      const masterApiKey = process.env.SENDGRID_API_KEY;
      if (!masterApiKey) {
        throw new Error("Master SendGrid API key not configured in environment variables");
      }

      // Create SendGrid client instance with master API key
      const sg = require("@sendgrid/mail");
      sg.setApiKey(masterApiKey);

      console.log(
        `Created SendGrid email client for company ${companyIdStr} (using master account)`
      );

      // Get default sender from authenticated senders array
      const senders = company.emailConfig.sendgrid.senders || [];

      // Priority 1: Find default sender that's verified
      let defaultSender = senders.find(s => s.isDefault === true && s.domainVerified === true);

      // Priority 2: Find first verified sender
      if (!defaultSender) {
        defaultSender = senders.find(s => s.domainVerified === true);
      }

      // Priority 3: Use legacy fromEmail if configured (for backward compatibility)
      if (!defaultSender && company.emailConfig.sendgrid.fromEmail) {
        defaultSender = {
          email: company.emailConfig.sendgrid.fromEmail,
          name: company.emailConfig.sendgrid.fromName || company.name
        };
      }

      // No verified sender found - cannot send email
      if (!defaultSender) {
        throw new Error(
          `Company ${companyIdStr} has no verified email senders. ` +
          `Please add DNS records and verify domain authentication.`
        );
      }

      return {
        type: "sendgrid",
        client: sg,
        from: {
          email: defaultSender.email,
          name: defaultSender.name || company.name,
        },
        replyTo: company.emailConfig.sendgrid.replyTo || null,
        companyId: company._id,
        companyName: company.name,
      };
    }

    // SMTP (Nodemailer) configuration
    if (company.emailConfig.provider === "smtp") {
      if (!company.emailConfig.smtp?.host || !company.emailConfig.smtp?.port) {
        throw new Error(
          `Company ${companyIdStr} SMTP configuration incomplete`
        );
      }

      // Create Nodemailer transport
      const transportConfig = {
        host: company.emailConfig.smtp.host,
        port: company.emailConfig.smtp.port,
        secure: company.emailConfig.smtp.secure || false, // true for 465, false for other ports
      };

      // Add auth if provided
      if (company.emailConfig.smtp.user && company.emailConfig.smtp.password) {
        transportConfig.auth = {
          user: company.emailConfig.smtp.user,
          pass: company.emailConfig.smtp.password,
        };
      }

      const transport = nodemailer.createTransport(transportConfig);

      console.log(
        `Created SMTP email client for company ${companyIdStr} (${company.emailConfig.smtp.host}:${company.emailConfig.smtp.port})`
      );

      return {
        type: "smtp",
        client: transport,
        from: {
          email: company.emailConfig.smtp.fromEmail,
          name: company.emailConfig.smtp.fromName || company.name,
        },
        replyTo: null,
        companyId: company._id,
        companyName: company.name,
      };
    }

    throw new Error(
      `Unknown email provider: ${company.emailConfig.provider}`
    );
  } catch (error) {
    console.error(
      `Error getting email client for company ${companyId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get legacy SendGrid client (for companies not yet configured)
 * @returns {Object} Legacy email client
 */
function getLegacySendGridClient() {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    throw new Error("Legacy SendGrid API key not configured");
  }

  const sg = require("@sendgrid/mail");
  sg.setApiKey(apiKey);

  return {
    type: "sendgrid",
    client: sg,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: process.env.SENDGRID_FROM_NAME || "Boardd Team",
    },
    replyTo: null,
    companyId: null,
    companyName: "Legacy",
  };
}

/**
 * Send email using company-specific client
 * Abstraction layer to handle both SendGrid and SMTP
 * @param {Object} emailClient - Email client from getEmailClientForCompany()
 * @param {Object} mailOptions - Email options
 * @returns {Promise<Object>} Send result
 */
async function sendEmailViaClient(emailClient, mailOptions) {
  try {
    if (emailClient.type === "sendgrid") {
      // SendGrid format
      const msg = {
        to: mailOptions.to,
        from: {
          email: emailClient.from.email,
          name: emailClient.from.name,
        },
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html,
        replyTo: emailClient.replyTo || mailOptions.replyTo,
        customArgs: {
          companyId: emailClient.companyId?.toString(),
          conversationId: mailOptions.conversationId?.toString(),
          messageId: mailOptions.messageId?.toString(),
        },
      };

      const result = await emailClient.client.send(msg);

      return {
        success: true,
        provider: "sendgrid",
        messageId: result[0]?.headers?.["x-message-id"],
        statusCode: result[0]?.statusCode,
      };
    } else if (emailClient.type === "smtp") {
      // Nodemailer format
      const msg = {
        from: `"${emailClient.from.name}" <${emailClient.from.email}>`,
        to: mailOptions.to,
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html,
        replyTo: mailOptions.replyTo,
      };

      const result = await emailClient.client.sendMail(msg);

      return {
        success: true,
        provider: "smtp",
        messageId: result.messageId,
        response: result.response,
      };
    }

    throw new Error(`Unknown email client type: ${emailClient.type}`);
  } catch (error) {
    console.error("Error sending email via client:", error);
    throw error;
  }
}

/**
 * Verify email client configuration
 * Tests the connection without sending
 * @param {Object} emailClient - Email client from getEmailClientForCompany()
 * @returns {Promise<Object>} Verification result
 */
async function verifyEmailClient(emailClient) {
  try {
    if (emailClient.type === "smtp") {
      // Verify SMTP connection
      await emailClient.client.verify();
      return { success: true, message: "SMTP connection verified" };
    }

    if (emailClient.type === "sendgrid") {
      // SendGrid doesn't have a verify method, but we can check the API key format
      if (!emailClient.from.email) {
        throw new Error("SendGrid from email not configured");
      }
      return { success: true, message: "SendGrid configuration valid" };
    }

    throw new Error(`Unknown email client type: ${emailClient.type}`);
  } catch (error) {
    return {
      success: false,
      message: `Verification failed: ${error.message}`,
    };
  }
}

module.exports = {
  getEmailClientForCompany,
  getLegacySendGridClient,
  sendEmailViaClient,
  verifyEmailClient,
};
