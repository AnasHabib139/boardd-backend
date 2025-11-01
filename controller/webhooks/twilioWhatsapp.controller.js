"use strict";

/**
 * Twilio WhatsApp Webhook Controller
 * Handles WhatsApp status callbacks and inbound WhatsApp messages
 */

const { generateResponse } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");
const chatMessageHelpers = require("../../models/chatMessageModel");
const chatConversationHelpers = require("../../models/chatConversationModel");
const { model: mongooseModel } = require("mongoose");
const ChatMessage = mongooseModel("ChatMessage");
const ChatConversation = mongooseModel("ChatConversation");
const { mapTwilioStatus } = require("../../providers/whatsapp.twilio");

/**
 * Handle Twilio WhatsApp status callback
 * POST /api/webhooks/whatsapp/twilio?messageId=<messageId>
 *
 * Updates delivery status in message.deliveries[] array
 * Emits socket event for real-time status updates
 */
exports.handleWhatsappStatusCallback = async (req, res, next) => {
  try {
    const { messageId } = req.query;
    const {
      MessageSid,
      MessageStatus,
      ErrorCode,
      ErrorMessage,
    } = req.body;

    // Extract company from middleware (for logging)
    const company = req.twilioCompany;
    const companyId = company?._id || null;

    console.log("Twilio WhatsApp status callback:", {
      messageId,
      MessageSid,
      MessageStatus,
      ErrorCode,
      companyId: companyId?.toString() || "legacy",
    });

    // Validate required params
    if (!messageId || !MessageSid || !MessageStatus) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Missing required webhook parameters",
      });
    }

    // Find message by internal messageId
    const message = await ChatMessage.findById(messageId);
    if (!message) {
      console.warn(`Message ${messageId} not found for WhatsApp status callback`);
      // Return 200 anyway to prevent Twilio retries
      return res.status(200).send("OK");
    }

    // Find the WhatsApp delivery in the deliveries array
    const whatsappDeliveryIndex = message.deliveries.findIndex(
      (d) => d.channel === "whatsapp" && d.providerMessageId === MessageSid
    );

    if (whatsappDeliveryIndex === -1) {
      console.warn(`WhatsApp delivery not found for MessageSid ${MessageSid}`);
      return res.status(200).send("OK");
    }

    // Map Twilio status to our internal status
    const internalStatus = mapTwilioStatus(MessageStatus);

    // Build update object
    const updateData = {
      [`deliveries.${whatsappDeliveryIndex}.status`]: internalStatus,
    };

    // Add deliveredAt timestamp if delivered or read
    if (internalStatus === "delivered" || MessageStatus === "read") {
      updateData[`deliveries.${whatsappDeliveryIndex}.deliveredAt`] = new Date();
    }

    // Add error info if failed
    if (internalStatus === "failed" && (ErrorCode || ErrorMessage)) {
      const errorMsg = ErrorCode
        ? `Twilio Error ${ErrorCode}: ${ErrorMessage || "WhatsApp delivery failed"}`
        : ErrorMessage || "WhatsApp delivery failed";
      updateData[`deliveries.${whatsappDeliveryIndex}.error`] = errorMsg;
    }

    // Update message in database
    await ChatMessage.findByIdAndUpdate(messageId, {
      $set: updateData,
    });

    // Emit socket event for real-time updates
    const io = req.app.get("io");
    if (io && message.companyId) {
      io.to(`company-${message.companyId}`).emit("chat:message:delivery", {
        messageId: message._id.toString(),
        conversationId: message.conversationId.toString(),
        channel: "whatsapp",
        status: internalStatus,
        providerMessageId: MessageSid,
        error: updateData[`deliveries.${whatsappDeliveryIndex}.error`] || null,
        deliveredAt: updateData[`deliveries.${whatsappDeliveryIndex}.deliveredAt`] || null,
      });
    }

    console.log(`WhatsApp status updated for message ${messageId}: ${internalStatus}`);

    // Always return 200 to Twilio to prevent retries
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Error in WhatsApp status callback:", error);
    // Still return 200 to prevent Twilio retries on our errors
    return res.status(200).send("OK");
  }
};

/**
 * Handle inbound WhatsApp message from client
 * POST /api/webhooks/whatsapp/twilio/inbound
 *
 * Creates inbound message in conversation
 * Maps sender WhatsApp to conversation via externalContacts
 * Updates lastClientInboundAt for 24h window tracking
 */
exports.handleInboundWhatsapp = async (req, res, next) => {
  try {
    const {
      From, // Client's WhatsApp number (whatsapp:+1234567890)
      To, // Our Twilio WhatsApp number
      Body, // WhatsApp message text
      MessageSid, // Twilio message ID
      NumMedia, // Number of media attachments
      ProfileName, // WhatsApp profile name
    } = req.body;

    // Extract company from middleware (for multi-tenant routing)
    const company = req.twilioCompany;
    const companyId = company?._id || null;

    // Validate required params
    if (!From || !Body) {
      console.warn("[Inbound WhatsApp] Missing From or Body");
      return res.status(200).send("OK");
    }

    // Extract E.164 phone number from WhatsApp format (whatsapp:+1234567890)
    const whatsappNumber = From.replace(/^whatsapp:/, "");

    // Build conversation query with company filter for security
    const conversationQuery = {
      type: "client",
      "externalContacts.whatsappE164s": whatsappNumber,
    };

    // Add companyId filter if multi-tenant mode
    if (companyId) {
      conversationQuery.companyId = companyId;
    }

    // Find conversation by matching external WhatsApp number
    const conversation = await ChatConversation.findOne(conversationQuery);

    if (!conversation) {
      console.warn(`[Inbound WhatsApp] No conversation found for ${whatsappNumber}`);
      return res.status(200).send("OK");
    }

    // Create TipTap JSON content from plain text
    const contentDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: Body,
            },
          ],
        },
      ],
    };

    // Find a client guest user in participants (if any)
    const clientUserId = conversation.participantIds?.[0];

    if (!clientUserId) {
      console.warn(`No participants found in conversation ${conversation._id}`);
      return res.status(200).send("OK");
    }

    // Create inbound message
    const messageData = {
      companyId: conversation.companyId,
      conversationId: conversation._id,
      authorId: clientUserId, // Guest user representing the client
      contentDoc,
      contentText: Body,
      attachmentsUrls: [], // TODO: Handle WhatsApp media if NumMedia > 0
      attachmentsMeta: [],
      links: [],
      direction: "inbound",
      senderRole: "client",
      senderContactInfo: whatsappNumber, // WhatsApp number for display (e.g., "+491709055176")
      senderChannel: "whatsapp", // Channel type for display label
      deliveries: [
        {
          channel: "whatsapp",
          status: "delivered",
          provider: "twilio",
          providerMessageId: MessageSid,
          deliveredAt: new Date(),
        },
      ],
    };

    const { createChatMessage } = require("../../models/chatMessageModel");
    const message = await createChatMessage(messageData);

    // Update conversation last message
    const { updateLastMessage } = require("../../models/chatConversationModel");
    await updateLastMessage(conversation._id, Body, new Date());

    // CRITICAL: Update lastClientInboundAt for WhatsApp 24h window
    // This allows team to send free-form messages for next 24 hours
    await ChatConversation.findByIdAndUpdate(conversation._id, {
      $set: { lastClientInboundAt: new Date() },
    });

    // Optionally update clientContact.name from ProfileName if not set
    if (ProfileName && !conversation.clientContact?.name) {
      await ChatConversation.findByIdAndUpdate(conversation._id, {
        $set: { "clientContact.name": ProfileName },
      });
    }

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

      // Emit notification to company room (for unread badges, etc.)
      io.to(`company-${conversation.companyId}`).emit("chat:notification", {
        type: "CHAT_MESSAGE",
        conversationId: conversation._id,
        messageId: message._id,
        fromUser: {
          _id: null,
          name: conversation.clientContact?.name || ProfileName || `${From} (WHATSAPP)`,
          image: null,
        },
        messagePreview: Body.substring(0, 100),
        conversationType: "client",
        channel: "whatsapp",
        timestamp: new Date(),
      });
    }

    console.log(
      `Inbound WhatsApp processed: message ${message._id} in conversation ${conversation._id}, lastClientInboundAt updated`
    );

    // Return TwiML response (empty response = no auto-reply)
    return res.status(200).type("text/xml").send("<Response></Response>");
  } catch (error) {
    console.error("Error processing inbound WhatsApp:", error);
    // Return 200 to prevent Twilio retries
    return res.status(200).type("text/xml").send("<Response></Response>");
  }
};
