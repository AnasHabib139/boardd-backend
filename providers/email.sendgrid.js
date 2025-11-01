"use strict";

/**
 * SendGrid Email Provider for Client Chat
 * Handles email sending via SendGrid with delivery tracking
 * Supports multi-tenant architecture with per-company email clients
 */

const sgMail = require("@sendgrid/mail");
const {
  getEmailClientForCompany,
  getLegacySendGridClient,
  sendEmailViaClient,
} = require("./emailClientFactory");

// Initialize legacy SendGrid with API key from environment
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn("SENDGRID_API_KEY not set - email sending will fail");
}

/**
 * Send email via SendGrid or SMTP (Multi-tenant version)
 * @param {Object} params - Email parameters
 * @param {String} params.companyId - Company ID (for multi-tenant routing)
 * @param {String} params.to - Recipient email address
 * @param {String} params.from - Sender email address (optional - uses default if not provided)
 * @param {String} params.subject - Email subject
 * @param {String} params.htmlContent - HTML email body
 * @param {String} params.textContent - Plain text email body (fallback)
 * @param {String} params.conversationId - For reply tracking
 * @param {String} params.messageId - Internal message ID
 * @param {Array} params.attachmentsUrls - Optional attachment URLs
 * @returns {Promise<Object>} { success, providerMessageId, error, from }
 */
exports.sendEmail = async (params) => {
  const {
    companyId,
    to,
    from,
    subject,
    htmlContent,
    textContent,
    conversationId,
    messageId,
    attachmentsUrls = [],
  } = params;

  try {
    // Validate required params
    if (!to || !subject || !htmlContent) {
      throw new Error("Missing required email parameters: to, subject, htmlContent");
    }

    // Get company-specific email client or use legacy
    let emailClient;
    let fromEmail;
    let fromName;

    if (companyId) {
      // Get company email client (uses master SendGrid account with domain authentication)
      emailClient = await getEmailClientForCompany(companyId);

      // If custom sender is specified, use it (already validated in router)
      if (from) {
        fromEmail = from;
        // Look up sender name from company's senders array
        const Company = require("mongoose").model("Company");
        const company = await Company.findById(companyId).select("emailConfig");
        const sender = company.emailConfig?.sendgrid?.senders?.find(s => s.email === from);
        fromName = sender?.name || fromEmail.split("@")[0]; // Fallback to email username
        console.log(`Using custom sender ${fromEmail} (${fromName}) for company ${companyId}`);
      } else {
        // Use default sender from email client
        fromEmail = emailClient.from.email;
        fromName = emailClient.from.name;
        console.log(
          `Using ${emailClient.type} email client for company ${companyId}`
        );
      }
    } else {
      // Legacy mode: Use global SendGrid client (for backward compatibility)
      emailClient = getLegacySendGridClient();
      fromEmail = from || emailClient.from.email;
      fromName = emailClient.from.name;
      console.log("Using legacy SendGrid client for email");
    }

    // Build reply-to address for conversation threading
    let replyToEmail = null;
    if (conversationId) {
      replyToEmail = `chat+${conversationId}@${extractDomain(fromEmail)}`;
    }

    // Build email options for the abstraction layer
    const mailOptions = {
      to,
      subject,
      text: textContent || stripHtml(htmlContent),
      html: htmlContent,
      replyTo: replyToEmail,
      conversationId,
      messageId,
    };

    // Send email using the client abstraction
    const result = await sendEmailViaClient(emailClient, mailOptions);

    console.log(
      `Email sent successfully via ${result.provider} to ${to}, messageId: ${result.messageId}`
    );

    return {
      success: true,
      providerMessageId: result.messageId,
      status: "sent",
      from: fromEmail,
      sentAt: new Date(),
    };
  } catch (error) {
    console.error("SendGrid email send error:", error);

    // Extract error message
    let errorMessage = error.message || "Unknown SendGrid error";
    if (error.response?.body?.errors) {
      errorMessage = error.response.body.errors
        .map((err) => err.message)
        .join(", ");
    }

    return {
      success: false,
      status: "failed",
      error: errorMessage,
    };
  }
};

/**
 * Strip HTML tags for plain text fallback
 * @param {String} html - HTML content
 * @returns {String} Plain text
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ") // Remove HTML tags
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Extract domain from email address
 * @param {String} email - Email address
 * @returns {String} Domain
 */
function extractDomain(email) {
  if (!email || !email.includes("@")) return "boardd.com";
  return email.split("@")[1];
}

/**
 * Process attachments from URLs (optional feature)
 * Converts S3 URLs to SendGrid attachment format
 * @param {Array<String>} attachmentUrls - Array of attachment URLs
 * @returns {Promise<Array>} SendGrid attachment objects
 */
async function processAttachments(attachmentUrls) {
  // TODO: Implement attachment download and base64 encoding
  // SendGrid requires attachments as base64 encoded content
  // For now, return empty array
  return [];
}
