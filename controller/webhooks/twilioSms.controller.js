"use strict";

/**
 * Twilio SMS Webhook Controller
 * Handles SMS status callbacks and inbound SMS messages
 */

const { generateResponse } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");
const chatMessageHelpers = require("../../models/chatMessageModel");
const chatConversationHelpers = require("../../models/chatConversationModel");
const { model: mongooseModel } = require("mongoose");
const ChatMessage = mongooseModel("ChatMessage");
const ChatConversation = mongooseModel("ChatConversation");
const { mapTwilioStatus } = require("../../providers/sms.twilio");

/**
 * Handle Twilio SMS status callback
 * POST /api/webhooks/sms/twilio?messageId=<messageId>
 *
 * Updates delivery status in message.deliveries[] array
 * Emits socket event for real-time status updates
 */
exports.handleSmsStatusCallback = async (req, res, next) => {
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

    console.log("Twilio SMS status callback:", {
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
      console.warn(`Message ${messageId} not found for SMS status callback`);
      // Return 200 anyway to prevent Twilio retries
      return res.status(200).send("OK");
    }

    // Find the SMS delivery in the deliveries array
    const smsDeliveryIndex = message.deliveries.findIndex(
      (d) => d.channel === "sms" && d.providerMessageId === MessageSid
    );

    if (smsDeliveryIndex === -1) {
      console.warn(`SMS delivery not found for MessageSid ${MessageSid}`);
      return res.status(200).send("OK");
    }

    // Map Twilio status to our internal status
    const internalStatus = mapTwilioStatus(MessageStatus);

    // Build update object
    const updateData = {
      [`deliveries.${smsDeliveryIndex}.status`]: internalStatus,
    };

    // Add deliveredAt timestamp if delivered
    if (internalStatus === "delivered") {
      updateData[`deliveries.${smsDeliveryIndex}.deliveredAt`] = new Date();
    }

    // Add error info if failed
    if (internalStatus === "failed" && (ErrorCode || ErrorMessage)) {
      const errorMsg = ErrorCode
        ? `Twilio Error ${ErrorCode}: ${ErrorMessage || "SMS delivery failed"}`
        : ErrorMessage || "SMS delivery failed";
      updateData[`deliveries.${smsDeliveryIndex}.error`] = errorMsg;
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
        channel: "sms",
        status: internalStatus,
        providerMessageId: MessageSid,
        error: updateData[`deliveries.${smsDeliveryIndex}.error`] || null,
        deliveredAt: updateData[`deliveries.${smsDeliveryIndex}.deliveredAt`] || null,
      });
    }

    console.log(`SMS status updated for message ${messageId}: ${internalStatus}`);

    // Always return 200 to Twilio to prevent retries
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Error in SMS status callback:", error);
    // Still return 200 to prevent Twilio retries on our errors
    return res.status(200).send("OK");
  }
};

/**
 * Handle inbound SMS from client
 * POST /api/webhooks/sms/twilio/inbound
 *
 * Creates inbound message in conversation
 * Maps sender phone to conversation via externalContacts
 */
exports.handleInboundSms = async (req, res, next) => {
  try {
    console.log("[Inbound SMS] ====== NEW INBOUND SMS WEBHOOK ======");

    const {
      From, // Client's phone number (E.164)
      To, // Our Twilio number
      Body, // SMS text content
      MessageSid, // Twilio message ID
      NumMedia, // Number of media attachments (MMS)
    } = req.body;

    // Extract company from middleware (for multi-tenant routing)
    const company = req.twilioCompany;
    const companyId = company?._id || null;

    console.log("[Inbound SMS] Webhook data:", {
      From,
      To,
      Body: Body?.substring(0, 100),
      MessageSid,
      NumMedia,
      companyId: companyId?.toString() || "legacy",
      hasCompany: !!company,
      fullBody: req.body
    });

    // Validate required params
    if (!From || !Body) {
      console.error("[Inbound SMS] ❌ Invalid webhook: missing From or Body");
      return res.status(200).send("OK");
    }

    // Build conversation query with company filter for security
    const conversationQuery = {
      type: "client",
      "externalContacts.phoneE164s": From,
    };

    // Add companyId filter if multi-tenant mode
    if (companyId) {
      conversationQuery.companyId = companyId;
    }

    console.log("[Inbound SMS] Looking up conversation with query:", conversationQuery);

    // Find conversation by matching external phone number
    const conversation = await ChatConversation.findOne(conversationQuery);

    if (!conversation) {
      console.error(`[Inbound SMS] ❌ No client conversation found for SMS from ${From}`);
      console.error(`[Inbound SMS] Query used:`, conversationQuery);

      // Debug: Check if any conversations exist with this phone in other fields
      const anyConversation = await ChatConversation.findOne({ type: "client" }).select("externalContacts clientContact");
      if (anyConversation) {
        console.log("[Inbound SMS] Sample conversation externalContacts:", anyConversation.externalContacts);
        console.log("[Inbound SMS] Sample conversation clientContact:", anyConversation.clientContact);
      }

      return res.status(200).send("OK");
    }

    console.log("[Inbound SMS] ✓ Conversation found:", {
      conversationId: conversation._id,
      companyId: conversation.companyId,
      participantCount: conversation.participantIds?.length,
      externalContacts: conversation.externalContacts
    });

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
    // For now, use the first participant as author (could be improved)
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
      attachmentsUrls: [], // TODO: Handle MMS media if NumMedia > 0
      attachmentsMeta: [],
      links: [],
      direction: "inbound",
      senderRole: "client",
      senderContactInfo: From, // Phone number for display (e.g., "+491709055176")
      senderChannel: "sms", // Channel type for display label
      deliveries: [
        {
          channel: "sms",
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

    // Update lastClientInboundAt for WhatsApp 24h window tracking
    await ChatConversation.findByIdAndUpdate(conversation._id, {
      $set: { lastClientInboundAt: new Date() },
    });

    // Emit socket event to notify team members
    const io = req.app.get("io");
    console.log("[Inbound SMS] Socket.io available:", !!io);

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
      const conversationRoom = `conversation:${conversation._id}`;
      console.log(`[Inbound SMS] Emitting chat:message:new to room: ${conversationRoom}`);

      io.to(conversationRoom).emit("chat:message:new", {
        message: populatedMessage,
      });

      console.log("[Inbound SMS] ✓ chat:message:new emitted");

      // Emit notification to company room (for unread badges, etc.)
      const companyRoom = `company-${conversation.companyId}`;
      console.log(`[Inbound SMS] Emitting chat:notification to room: ${companyRoom}`);

      io.to(companyRoom).emit("chat:notification", {
        type: "CHAT_MESSAGE",
        conversationId: conversation._id,
        messageId: message._id,
        fromUser: {
          _id: null,
          name: conversation.clientContact?.name || `${From} (SMS)`,
          image: null,
        },
        messagePreview: Body.substring(0, 100),
        conversationType: "client",
        channel: "sms",
        timestamp: new Date(),
      });

      console.log("[Inbound SMS] ✓ chat:notification emitted");
    } else {
      console.error("[Inbound SMS] ❌ Socket.io not available - events not emitted!");
    }

    console.log(
      `[Inbound SMS] ✓✓✓ Inbound SMS processed successfully: message ${message._id} in conversation ${conversation._id}, lastClientInboundAt updated`
    );

    // Return TwiML response (empty response = no auto-reply)
    return res.status(200).type("text/xml").send("<Response></Response>");
  } catch (error) {
    console.error("Error processing inbound SMS:", error);
    // Return 200 to prevent Twilio retries
    return res.status(200).type("text/xml").send("<Response></Response>");
  }
};
