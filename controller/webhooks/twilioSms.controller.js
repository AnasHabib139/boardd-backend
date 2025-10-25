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

    console.log("Twilio SMS status callback:", {
      messageId,
      MessageSid,
      MessageStatus,
      ErrorCode,
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
    const {
      From, // Client's phone number (E.164)
      To, // Our Twilio number
      Body, // SMS text content
      MessageSid, // Twilio message ID
      NumMedia, // Number of media attachments (MMS)
    } = req.body;

    console.log("Inbound SMS received:", {
      From,
      To,
      Body: Body?.substring(0, 100),
      MessageSid,
      NumMedia,
    });

    // Validate required params
    if (!From || !Body) {
      console.warn("Invalid inbound SMS: missing From or Body");
      return res.status(200).send("OK");
    }

    // Find conversation by matching external phone number
    const conversation = await ChatConversation.findOne({
      type: "client",
      "externalContacts.phoneE164s": From,
    });

    if (!conversation) {
      console.warn(`No client conversation found for SMS from ${From}`);
      // TODO: Option to create new conversation or send auto-reply
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
    if (io) {
      const { findUser } = require("../../models/userModel");
      const author = await findUser({ _id: clientUserId });

      const populatedMessage = {
        ...message.toObject(),
        author: author
          ? {
              _id: author._id,
              name: author.name,
              email: author.email,
              image: author.image,
            }
          : null,
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
          _id: author?._id,
          name: conversation.clientContact?.name || "Client",
          image: author?.image || null,
        },
        messagePreview: Body.substring(0, 100),
        conversationType: "client",
        channel: "sms",
        timestamp: new Date(),
      });
    }

    console.log(
      `Inbound SMS processed: message ${message._id} in conversation ${conversation._id}`
    );

    // Return TwiML response (empty response = no auto-reply)
    return res.status(200).type("text/xml").send("<Response></Response>");
  } catch (error) {
    console.error("Error processing inbound SMS:", error);
    // Return 200 to prevent Twilio retries
    return res.status(200).type("text/xml").send("<Response></Response>");
  }
};
