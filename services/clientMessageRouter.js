"use strict";

/**
 * Client Message Router Service
 *
 * Orchestrates multi-channel delivery for client chat messages.
 * Routes messages to appropriate providers (Board, Email, SMS, WhatsApp)
 * and tracks delivery status.
 */

const chatMessageHelpers = require("../models/chatMessageModel");
const chatConversationHelpers = require("../models/chatConversationModel");
const { model: mongooseModel } = require("mongoose");
const ChatMessage = mongooseModel("ChatMessage");
const ChatConversation = mongooseModel("ChatConversation");
const tiptapRenderer = require("./tiptapRenderer");
const boardProvider = require("../providers/board.internal");
const emailProvider = require("../providers/email.sendgrid");
const smsProvider = require("../providers/sms.twilio");
const whatsappProvider = require("../providers/whatsapp.twilio");

/**
 * Route message to multiple delivery channels
 * @param {Object} params - Delivery parameters
 * @param {String} params.messageId - Message ID from database
 * @param {String} params.conversationId - Conversation ID
 * @param {Array<String>} params.deliveryModes - Channels to deliver to: ['board', 'email', 'sms', 'whatsapp']
 * @param {Object} params.recipient - Recipient contact information
 * @param {String} params.recipient.name - Recipient name
 * @param {String} params.recipient.email - Recipient email (for email delivery)
 * @param {String} params.recipient.phoneE164 - Recipient phone E.164 format (for SMS)
 * @param {String} params.recipient.whatsappE164 - Recipient WhatsApp E.164 format (for WhatsApp)
 * @param {String} params.emailSubject - Email subject (required for email delivery)
 * @param {Object} params.whatsappTemplate - WhatsApp template config (for outside 24h window)
 * @param {Object} params.content - TipTap JSON content
 * @param {Date} params.lastClientInboundAt - Last inbound message from client (for WhatsApp 24h check)
 * @param {Object} params.io - Socket.io instance for emitting delivery events
 * @param {String} params.companyId - Company ID for socket room targeting
 * @returns {Promise<Object>} { success, deliveries, errors }
 */
exports.routeMessage = async (params) => {
  const {
    messageId,
    conversationId,
    deliveryModes = [],
    recipient = {},
    emailSubject,
    whatsappTemplate,
    content,
    lastClientInboundAt,
    io,
    companyId,
  } = params;

  try {
    // Validate required params
    if (!messageId || !conversationId || !deliveryModes.length) {
      throw new Error("Missing required parameters: messageId, conversationId, deliveryModes");
    }

    // Validate recipient info for each delivery mode
    const validationErrors = validateRecipient(deliveryModes, recipient, emailSubject);
    if (validationErrors.length > 0) {
      throw new Error(`Recipient validation failed: ${validationErrors.join(", ")}`);
    }

    // Initialize deliveries array for database
    const deliveries = [];

    // Prepare delivery promises for parallel execution
    const deliveryPromises = deliveryModes.map(async (channel) => {
      try {
        let result;

        switch (channel) {
          case "board":
            result = await deliverToBoard({ messageId });
            break;

          case "email":
            result = await deliverToEmail({
              companyId,
              messageId,
              conversationId,
              recipient,
              emailSubject,
              content,
            });
            break;

          case "sms":
            result = await deliverToSms({
              companyId,
              messageId,
              recipient,
              content,
            });
            break;

          case "whatsapp":
            result = await deliverToWhatsapp({
              companyId,
              messageId,
              recipient,
              content,
              lastClientInboundAt,
              whatsappTemplate,
            });
            break;

          default:
            throw new Error(`Unknown delivery channel: ${channel}`);
        }

        // Build delivery record
        const delivery = {
          channel,
          status: result.status || "pending",
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          sentAt: result.sentAt || new Date(),
          error: result.error || null,
        };

        deliveries.push(delivery);

        // Emit delivery status event via socket
        if (io && companyId) {
          emitDeliveryStatus(io, companyId, {
            messageId,
            conversationId,
            delivery,
          });
        }

        return { channel, success: true, delivery };
      } catch (error) {
        console.error(`Delivery failed for channel ${channel}:`, error);

        // Build failed delivery record
        const delivery = {
          channel,
          status: "failed",
          error: error.message || "Unknown delivery error",
        };

        deliveries.push(delivery);

        // Emit failure event
        if (io && companyId) {
          emitDeliveryStatus(io, companyId, {
            messageId,
            conversationId,
            delivery,
          });
        }

        return { channel, success: false, error: error.message, delivery };
      }
    });

    // Execute all deliveries in parallel
    const results = await Promise.allSettled(deliveryPromises);

    // Update message with deliveries
    await ChatMessage.findByIdAndUpdate(messageId, {
      $set: { deliveries },
    });

    // Update conversation externalContacts if new recipients
    await updateExternalContacts(conversationId, recipient, deliveryModes);

    // Extract errors from failed deliveries
    const errors = results
      .filter((r) => r.status === "rejected" || (r.value && !r.value.success))
      .map((r) => r.reason?.message || r.value?.error || "Unknown error");

    // Determine overall success (at least one delivery succeeded)
    const anySuccess = results.some((r) => r.status === "fulfilled" && r.value?.success);

    return {
      success: anySuccess,
      deliveries,
      errors: errors.length > 0 ? errors : null,
    };
  } catch (error) {
    console.error("Client message routing error:", error);
    throw error;
  }
};

/**
 * Validate recipient info for requested delivery channels
 * @param {Array<String>} deliveryModes - Channels to validate
 * @param {Object} recipient - Recipient info
 * @param {String} emailSubject - Email subject
 * @returns {Array<String>} Array of validation error messages (empty if valid)
 */
function validateRecipient(deliveryModes, recipient, emailSubject) {
  const errors = [];

  deliveryModes.forEach((channel) => {
    switch (channel) {
      case "board":
        // Board delivery requires no external recipient info
        break;

      case "email":
        if (!recipient.email) {
          errors.push("Email delivery requires recipient.email");
        }
        if (!emailSubject || emailSubject.trim() === "") {
          errors.push("Email delivery requires emailSubject");
        }
        break;

      case "sms":
        if (!recipient.phoneE164) {
          errors.push("SMS delivery requires recipient.phoneE164");
        }
        break;

      case "whatsapp":
        if (!recipient.whatsappE164) {
          errors.push("WhatsApp delivery requires recipient.whatsappE164");
        }
        break;

      default:
        errors.push(`Unknown delivery channel: ${channel}`);
    }
  });

  return errors;
}

/**
 * Deliver message to Board (internal chat)
 * @param {Object} params
 * @returns {Promise<Object>} Delivery result
 */
async function deliverToBoard({ messageId }) {
  return boardProvider.sendBoard({ messageId });
}

/**
 * Deliver message to Email via SendGrid
 * @param {Object} params
 * @returns {Promise<Object>} Delivery result
 */
async function deliverToEmail({ companyId, messageId, conversationId, recipient, emailSubject, content }) {
  // Convert TipTap JSON to email HTML
  const htmlContent = tiptapRenderer.toEmailHtml(content);
  const textContent = tiptapRenderer.toPlainText(content);

  return emailProvider.sendEmail({
    companyId,
    to: recipient.email,
    subject: emailSubject,
    htmlContent,
    textContent,
    conversationId,
    messageId,
  });
}

/**
 * Deliver message to SMS via Twilio
 * @param {Object} params
 * @returns {Promise<Object>} Delivery result
 */
async function deliverToSms({ companyId, messageId, recipient, content }) {
  // Convert TipTap JSON to SMS text
  const textContent = tiptapRenderer.toSmsText(content);

  return smsProvider.sendSms({
    companyId,
    to: recipient.phoneE164,
    textContent,
    messageId,
  });
}

/**
 * Deliver message to WhatsApp via Twilio
 * @param {Object} params
 * @returns {Promise<Object>} Delivery result
 */
async function deliverToWhatsapp({
  companyId,
  messageId,
  recipient,
  content,
  lastClientInboundAt,
  whatsappTemplate,
}) {
  // Convert TipTap JSON to WhatsApp text
  const textContent = tiptapRenderer.toWhatsappText(content);

  return whatsappProvider.sendWhatsapp({
    companyId,
    to: recipient.whatsappE164,
    textContent: whatsappTemplate ? null : textContent, // Only send text if not using template
    template: whatsappTemplate || null,
    messageId,
    lastClientInboundAt,
  });
}

/**
 * Update conversation externalContacts with new recipient info
 * Tracks all external identifiers used in conversation for inbound mapping
 * @param {String} conversationId - Conversation ID
 * @param {Object} recipient - Recipient info
 * @param {Array<String>} deliveryModes - Channels delivered to
 * @returns {Promise<void>}
 */
async function updateExternalContacts(conversationId, recipient, deliveryModes) {
  try {
    const updates = {};

    // Add email to externalContacts.emails if delivered via email
    if (deliveryModes.includes("email") && recipient.email) {
      updates["externalContacts.emails"] = recipient.email;
    }

    // Add phone to externalContacts.phoneE164s if delivered via SMS
    if (deliveryModes.includes("sms") && recipient.phoneE164) {
      updates["externalContacts.phoneE164s"] = recipient.phoneE164;
    }

    // Add WhatsApp to externalContacts.whatsappE164s if delivered via WhatsApp
    if (deliveryModes.includes("whatsapp") && recipient.whatsappE164) {
      updates["externalContacts.whatsappE164s"] = recipient.whatsappE164;
    }

    // Update conversation if there are any new contacts to add
    if (Object.keys(updates).length > 0) {
      await ChatConversation.findByIdAndUpdate(
        conversationId,
        {
          $addToSet: updates, // Use $addToSet to avoid duplicates
        },
        { new: true }
      );
    }
  } catch (error) {
    console.error("Error updating external contacts:", error);
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Emit delivery status event via Socket.io
 * @param {Object} io - Socket.io instance
 * @param {String} companyId - Company ID for room targeting
 * @param {Object} data - Delivery event data
 */
function emitDeliveryStatus(io, companyId, data) {
  try {
    const { messageId, conversationId, delivery } = data;

    // Emit to company room so all participants see delivery status
    io.to(`company-${companyId}`).emit("chat:message:delivery", {
      messageId,
      conversationId,
      channel: delivery.channel,
      status: delivery.status,
      providerMessageId: delivery.providerMessageId,
      error: delivery.error,
      sentAt: delivery.sentAt,
      deliveredAt: delivery.deliveredAt,
    });
  } catch (error) {
    console.error("Error emitting delivery status:", error);
    // Don't throw - socket emission is best-effort
  }
}

/**
 * Export helpers for testing and webhook use
 */
exports.validateRecipient = validateRecipient;
exports.updateExternalContacts = updateExternalContacts;
