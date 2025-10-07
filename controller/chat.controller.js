"use strict";

const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findChatConversation, aggregateChatConversations } = require("../models/chatConversationModel");
const { getAllChatMessages } = require("../models/chatMessageModel");
const { getConversationMessagesQuery, getUserConversationsQuery } = require("./queries/chatQueries");

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
 * Resolve conversation (find or create DM/Group DM)
 * POST /api/chat/conversations/resolve
 */
exports.resolveConversation = async (req, res, next) => {
  try {
    const { type, participantIds } = req.body;
    const userId = req.user.id.toString();

    // Verify user is authenticated
    if (!req.user || !req.user.id) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    // Validate input
    if (!type || !["dm", "group_dm"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Type must be either 'dm' or 'group_dm'",
      });
    }

    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "participantIds must be a non-empty array",
      });
    }

    // Validate DM has exactly 2 participants
    if (type === "dm" && participantIds.length !== 2) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "DM conversations must have exactly 2 participants",
      });
    }

    // Validate group_dm has at least 3 participants
    if (type === "group_dm" && participantIds.length < 3) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Group DM conversations must have at least 3 participants",
      });
    }

    // Verify user is included in participants
    if (!participantIds.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "You must be included in the participants list",
      });
    }

    // Get user's company ID
    const { findUser } = require("../models/userModel");
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Verify all participants exist and are in the same company
    for (const participantId of participantIds) {
      const participant = await findUser({ _id: participantId });
      if (!participant) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `User with ID ${participantId} not found`,
        });
      }
      if (participant.companyId.toString() !== user.companyId.toString()) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "All participants must be from the same company",
        });
      }
    }

    // Resolve conversation (find or create)
    const { resolveConversation } = require("../models/chatConversationModel");
    const result = await resolveConversation({
      companyId: user.companyId,
      type,
      participantIds,
      createdBy: userId,
    }, true); // createIfMissing = true

    return generateResponse(
      {
        conversation: result.conversation,
        created: result.created,
      },
      result.created ? "Conversation created successfully" : "Conversation found",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in resolveConversation:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get user's DM and Group DM conversations
 * GET /api/chat/conversations
 */
exports.getConversations = async (req, res, next) => {
  try {
    const { page, limit } = req.query;

    // Verify user is authenticated
    if (!req.user || !req.user.id) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    const userId = req.user.id.toString();

    // Get user's company ID
    const { findUser } = require("../models/userModel");
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const companyId = user.companyId.toString();

    // Parse pagination params
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    // Build aggregation query with pagination
    const query = getUserConversationsQuery(userId, companyId, pageNum, limitNum);

    // Execute aggregation
    const result = await aggregateChatConversations(query);

    // Extract data from faceted result
    const data = result[0] || {
      conversations: [],
      totalUnreadCount: 0,
      totalConversations: 0,
    };

    // Build pagination metadata
    const pagination = {
      page: pageNum,
      limit: limitNum,
      total: data.totalConversations,
      totalPages: Math.ceil(data.totalConversations / limitNum),
      hasNextPage: pageNum < Math.ceil(data.totalConversations / limitNum),
      hasPrevPage: pageNum > 1,
    };

    return generateResponse(
      {
        conversations: data.conversations,
        pagination,
        totalUnreadCount: data.totalUnreadCount,
      },
      "Conversations fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getConversations:", error);
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
