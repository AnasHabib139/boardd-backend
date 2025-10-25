"use strict";

/**
 * SendGrid Email Provider for Client Chat
 * Handles email sending via SendGrid with delivery tracking
 */

const sgMail = require("@sendgrid/mail");

// Initialize SendGrid with API key from environment
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn("SENDGRID_API_KEY not set - email sending will fail");
}

/**
 * Send email via SendGrid
 * @param {Object} params - Email parameters
 * @param {String} params.to - Recipient email address
 * @param {String} params.subject - Email subject
 * @param {String} params.htmlContent - HTML email body
 * @param {String} params.textContent - Plain text email body (fallback)
 * @param {String} params.conversationId - For reply tracking
 * @param {Array} params.attachmentsUrls - Optional attachment URLs
 * @returns {Promise<Object>} { success, providerMessageId, error }
 */
exports.sendEmail = async (params) => {
  const {
    to,
    subject,
    htmlContent,
    textContent,
    conversationId,
    attachmentsUrls = [],
  } = params;

  try {
    // Validate required params
    if (!to || !subject || !htmlContent) {
      throw new Error("Missing required email parameters: to, subject, htmlContent");
    }

    // Validate SendGrid is configured
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error("SendGrid API key not configured");
    }

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@boardd.com";
    const fromName = process.env.SENDGRID_FROM_NAME || "Boardd Support";

    // Build email message
    const msg = {
      to,
      from: {
        email: fromEmail,
        name: fromName,
      },
      subject,
      text: textContent || stripHtml(htmlContent), // Fallback to stripped HTML if no text provided
      html: htmlContent,
      // Add custom headers for tracking and threading
      customArgs: {
        conversationId: conversationId || "",
        source: "client_chat",
      },
      // Support reply tracking via custom reply-to
      // Format: chat+<conversationId>@yourdomain.com
      ...(conversationId && {
        replyTo: {
          email: `chat+${conversationId}@${extractDomain(fromEmail)}`,
          name: fromName,
        },
      }),
    };

    // TODO: Add attachments support if needed
    // if (attachmentsUrls && attachmentsUrls.length > 0) {
    //   msg.attachments = await processAttachments(attachmentsUrls);
    // }

    // Send email via SendGrid
    const response = await sgMail.send(msg);

    // SendGrid returns array of responses (one per recipient)
    const sendGridResponse = response[0];

    // Extract message ID from headers
    const messageId = sendGridResponse.headers?.["x-message-id"] || null;

    console.log(`Email sent successfully via SendGrid to ${to}, messageId: ${messageId}`);

    return {
      success: true,
      providerMessageId: messageId,
      status: "sent", // SendGrid returns 202 Accepted, actual delivery tracked via webhook
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
