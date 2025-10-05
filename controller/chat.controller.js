"use strict";

const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findChatConversation } = require("../models/chatConversationModel");
const { getAllChatMessages } = require("../models/chatMessageModel");
const { getConversationMessagesQuery } = require("./queries/chatQueries");

/**
 * Get chat messages for a conversation
 * GET /api/chat/conversations/:conversationId/messages
 */
exports.getConversationMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { page, limit, parentMessageId } = req.query;

    // Verify user is authenticated
    if (!req.user || !req.user.id) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    const userId = req.user.id.toString();

    // Check if conversation exists
    const conversation = await findChatConversation({ _id: conversationId });
    if (!conversation) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Conversation not found",
      });
    }

    // Verify user has access to conversation
    const hasAccess = await verifyConversationAccess(conversation, userId);
    if (!hasAccess) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this conversation",
      });
    }

    // Build aggregation query
    const query = getConversationMessagesQuery(
      conversationId,
      parentMessageId || null
    );

    // Get paginated messages
    const result = await getAllChatMessages({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      responseKey: "messages",
    });

    return generateResponse(
      result,
      "Messages fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getConversationMessages:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Helper: Verify user has access to conversation
 */
async function verifyConversationAccess(conversation, userId) {
  // For channel conversations, check Channel.members dynamically
  if (conversation.type === "channel") {
    const { findChannel } = require("../models/channelModel");
    const channel = await findChannel({ _id: conversation.channelId });
    if (!channel) return false;

    return channel.members.some((memberId) => memberId.toString() === userId);
  }

  // For DM/Group DM, check participantIds
  return conversation.participantIds.some((id) => id.toString() === userId);
}
