"use strict";

/**
 * SendGrid Inbound Email Webhook Controller
 * Handles inbound emails from clients replying to chat emails
 */

const { generateResponse } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");
const chatMessageHelpers = require("../../models/chatMessageModel");
const chatConversationHelpers = require("../../models/chatConversationModel");
const { model: mongooseModel } = require("mongoose");
const ChatMessage = mongooseModel("ChatMessage");
const ChatConversation = mongooseModel("ChatConversation");

/**
 * Handle inbound email from SendGrid Inbound Parse
 * POST /api/webhooks/email/sendgrid
 *
 * SendGrid parses incoming emails and POSTs to this webhook
 * Maps sender email to conversation via externalContacts or reply-to header
 * Creates inbound message in conversation
 *
 * SendGrid Inbound Parse payload:
 * - from: Sender email
 * - to: Recipient email (e.g., chat+<conversationId>@domain.com)
 * - subject: Email subject
 * - text: Plain text body
 * - html: HTML body
 * - envelope: JSON with from/to addresses
 * - headers: Raw email headers
 */
exports.handleInboundEmail = async (req, res, next) => {
  try {
    const {
      from, // Sender email (Name <email@example.com>)
      to, // Recipient (chat+<conversationId>@domain.com)
      subject,
      text, // Plain text body
      html, // HTML body
      envelope, // JSON envelope data
    } = req.body;

    // Validate required params
    if (!from || !to) {
      console.warn("[Inbound Email] Missing from or to");
      return res.status(200).send("OK");
    }

    // Extract email address from "Name <email@example.com>" format
    const fromEmail = extractEmailAddress(from);

    if (!fromEmail) {
      console.warn("[Inbound Email] Could not extract email address");
      return res.status(200).send("OK");
    }

    // Try to find conversation by conversationId in reply-to address
    // Format: chat+<conversationId>@domain.com
    let conversation = null;

    const conversationIdMatch = to.match(/chat\+([a-f0-9]{24})@/i);
    if (conversationIdMatch) {
      const conversationId = conversationIdMatch[1];
      conversation = await ChatConversation.findById(conversationId);

      if (conversation && conversation.type !== "client") {
        conversation = null;
      }
    }

    // Fallback: Try to find by matching sender email in externalContacts
    if (!conversation) {
      conversation = await ChatConversation.findOne({
        type: "client",
        "externalContacts.emails": fromEmail,
      });
    }

    if (!conversation) {
      console.warn(`[Inbound Email] No conversation found for ${fromEmail}`);
      return res.status(200).send("OK");
    }

    // Extract body text (prefer plain text, fallback to HTML)
    const bodyText = text || stripHtmlSimple(html) || "";

    if (!bodyText.trim()) {
      console.warn("[Inbound Email] Empty email body");
      return res.status(200).send("OK");
    }

    // Clean email body (remove quoted replies, signatures, etc.)
    const cleanedBody = cleanEmailBody(bodyText);

    // Create TipTap JSON content from plain text
    const contentDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: cleanedBody,
            },
          ],
        },
      ],
    };

    // Find a client guest user in participants
    const clientUserId = conversation.participantIds?.[0];

    if (!clientUserId) {
      console.warn(`[Inbound Email] No participants in conversation ${conversation._id}`);
      return res.status(200).send("OK");
    }

    // Create inbound message
    const messageData = {
      companyId: conversation.companyId,
      conversationId: conversation._id,
      authorId: clientUserId, // Guest user representing the client
      contentDoc,
      contentText: cleanedBody,
      attachmentsUrls: [], // TODO: Handle email attachments
      attachmentsMeta: [],
      links: [],
      direction: "inbound",
      senderRole: "client",
      senderContactInfo: fromEmail, // Email address for display (e.g., "client@example.com")
      senderChannel: "email", // Channel type for display label
      emailSubject: subject || "(No Subject)",
      deliveries: [
        {
          channel: "email",
          status: "delivered",
          provider: "sendgrid",
          deliveredAt: new Date(),
        },
      ],
    };

    const { createChatMessage } = require("../../models/chatMessageModel");
    const message = await createChatMessage(messageData);

    // Update conversation last message
    const { updateLastMessage } = require("../../models/chatConversationModel");
    const preview = subject ? `${subject}: ${cleanedBody}` : cleanedBody;
    await updateLastMessage(conversation._id, preview, new Date());

    // Update lastClientInboundAt for WhatsApp 24h window tracking
    // (email replies reset the window for all channels)
    await ChatConversation.findByIdAndUpdate(conversation._id, {
      $set: { lastClientInboundAt: new Date() },
    });

    // Add sender email to externalContacts if not already tracked
    await ChatConversation.findByIdAndUpdate(
      conversation._id,
      {
        $addToSet: { "externalContacts.emails": fromEmail },
      }
    );

    // Emit socket event to notify team members
    const io = req.app.get("io");
    if (io) {
      // For inbound messages, format author to show contact info + channel
      // This matches the API query logic in chatQueries.js
      const populatedMessage = {
        ...message.toObject(),
        author: {
          _id: null,
          name: `${message.senderContactInfo} (${message.senderChannel.toUpperCase()})`,
          email: message.senderChannel === "email" ? message.senderContactInfo : null,
          image: null
        }
      };

      // Broadcast to conversation room
      io.to(`conversation:${conversation._id}`).emit("chat:message:new", {
        message: populatedMessage,
      });

      // Emit notification to company room
      io.to(`company-${conversation.companyId}`).emit("chat:notification", {
        type: "CHAT_MESSAGE",
        conversationId: conversation._id,
        messageId: message._id,
        fromUser: {
          _id: null,
          name: conversation.clientContact?.name || extractNameFromEmail(from) || `${fromEmail} (EMAIL)`,
          image: null,
        },
        messagePreview: cleanedBody.substring(0, 100),
        conversationType: "client",
        channel: "email",
        timestamp: new Date(),
      });
    }

    // Return 200 to SendGrid
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Error processing inbound email:", error);
    // Return 200 to prevent SendGrid retries
    return res.status(200).send("OK");
  }
};

/**
 * Extract email address from "Name <email@example.com>" format
 * @param {String} emailString - Email string
 * @returns {String|null} Email address or null
 */
function extractEmailAddress(emailString) {
  if (!emailString) return null;

  // Match email in angle brackets: Name <email@example.com>
  const match = emailString.match(/<([^>]+)>/);
  if (match) {
    return match[1].trim().toLowerCase();
  }

  // If no angle brackets, assume entire string is email
  if (emailString.includes("@")) {
    return emailString.trim().toLowerCase();
  }

  return null;
}

/**
 * Extract name from "Name <email@example.com>" format
 * @param {String} emailString - Email string
 * @returns {String|null} Name or null
 */
function extractNameFromEmail(emailString) {
  if (!emailString) return null;

  // Match name before angle bracket: Name <email@example.com>
  const match = emailString.match(/^([^<]+)</);
  if (match) {
    return match[1].trim();
  }

  return null;
}

/**
 * Strip HTML tags for plain text (simple version)
 * @param {String} html - HTML content
 * @returns {String} Plain text
 */
function stripHtmlSimple(html) {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, "") // Remove style tags
    .replace(/<script[^>]*>.*?<\/script>/gi, "") // Remove script tags
    .replace(/<[^>]+>/g, " ") // Remove HTML tags
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Clean email body by removing quoted replies and signatures
 * @param {String} body - Email body text
 * @returns {String} Cleaned body
 */
function cleanEmailBody(body) {
  if (!body) return "";

  // Split by lines
  const lines = body.split("\n");
  const cleanedLines = [];

  // Common reply indicators
  const replyIndicators = [
    /^On .+ wrote:$/i, // "On Jan 1, 2025, Name wrote:"
    /^From:.+$/i, // "From: Name <email>"
    /^Sent:.+$/i, // "Sent: Monday, January 1, 2025"
    /^Date:.+$/i, // "Date: Jan 1, 2025"
    /^Subject:.+$/i, // "Subject: Re: ..."
    /^-+\s*Original Message\s*-+$/i, // "---- Original Message ----"
    /^>{1,}/i, // Lines starting with > (quoted text)
  ];

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at reply indicators
    const isReply = replyIndicators.some((regex) => regex.test(trimmed));
    if (isReply) {
      break;
    }

    // Stop at common signature separators
    if (trimmed === "--" || trimmed === "___") {
      break;
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n").trim();
}
