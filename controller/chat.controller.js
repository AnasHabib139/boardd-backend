"use strict";

const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findChatConversation, aggregateChatConversations } = require("../models/chatConversationModel");
const { getAllChatMessages } = require("../models/chatMessageModel");
const { getConversationMessagesQuery, getUserConversationsQuery, getConversationWithChatName, getClientContactInfoQuery } = require("./queries/chatQueries");
const { aggregateChannelTabs } = require("../models/channelTabsModel");

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

    // Extract messaging channels and client contact info from first message (if client conversation)
    let responseData = { ...result };

    if (result.messages && result.messages.length > 0) {
      const firstMessage = result.messages[0];

      // Add messaging channels and client contact info to response root (only if present)
      if (firstMessage.conversationType === "client") {
        responseData.conversationType = firstMessage.conversationType;
        responseData.messagingChannels = firstMessage.messagingChannels;
        responseData.clientContactInfo = firstMessage.clientContactInfo;

        // Remove these fields from individual messages to reduce payload
        responseData.messages = result.messages.map(msg => {
          const { conversationType, messagingChannels, clientContactInfo, ...messageData } = msg;
          return messageData;
        });
      }
    } else if (conversation.type === "client") {
      // No messages yet, but conversation is client type - fetch client details separately
      const clientInfoQuery = getClientContactInfoQuery(conversation.channelId.toString());
      const clientInfoResult = await aggregateChannelTabs(clientInfoQuery);

      if (clientInfoResult && clientInfoResult.length > 0) {
        responseData.conversationType = "client";
        responseData.clientContactInfo = clientInfoResult[0].clientContactInfo;
      }
    }

    return generateResponse(
      responseData,
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
 * Resolve conversation (find or create DM/Group DM/Client Chat)
 * POST /api/chat/conversations/resolve
 */
exports.resolveConversation = async (req, res, next) => {
  try {
    const { type, participantIds, channelId, clientContact } = req.body;
    const userId = req.user.id.toString();

    // Verify user is authenticated
    if (!req.user || !req.user.id) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    // Validate input
    if (!type || !["dm", "group_dm", "client"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Type must be either 'dm', 'group_dm', or 'client'",
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

    // ==================== CLIENT CHAT TYPE ====================
    if (type === "client") {
      // Validate channelId is provided
      if (!channelId) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "channelId is required for client conversations",
        });
      }

      // Verify channel exists and user has access
      const { findChannel } = require("../models/channelModel");
      const channel = await findChannel({ _id: channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Verify user is a channel member
      const isChannelMember = channel.members.some(
        (memberId) => memberId.toString() === userId
      );
      if (!isChannelMember) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have access to this channel",
        });
      }

      // Verify channel belongs to user's company
      if (channel.companyId.toString() !== user.companyId.toString()) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "Channel must belong to your company",
        });
      }

      // CHECK-ONLY MODE: If no participantIds provided, check if conversation exists
      if (!participantIds || participantIds.length === 0) {
        const { resolveConversation } = require("../models/chatConversationModel");
        const result = await resolveConversation(
          {
            companyId: user.companyId,
            type: "client",
            channelId,
            createdBy: userId,
          },
          false // Don't create, just check
        );

        return generateResponse(
          {
            exists: !!result.conversation,
            requiresSetup: !result.conversation,
            conversation: result.conversation || null,
          },
          result.conversation
            ? "Client conversation exists"
            : "Client conversation requires setup",
          res,
          STATUS_CODES.SUCCESS
        );
      }

      // CREATE MODE: participantIds provided, create/find conversation
      // Only admins can create client conversations
      if (user.role !== "admin") {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "Only admins can create or modify client conversations",
        });
      }

      // Validate all participants exist and are in the same company
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

      // Validate phone numbers and emails for uniqueness in channel (if provided)
      if (clientContact) {
        const { isPhoneNumberAvailable, isEmailAvailable } = require("../models/chatConversationModel");

        // Check phone number
        if (clientContact.phoneE164) {
          const { available, existingConversation } = await isPhoneNumberAvailable(
            clientContact.phoneE164,
            channelId,
            user.companyId
          );
          if (!available) {
            return next({
              statusCode: STATUS_CODES.BAD_REQUEST,
              message: `Phone number ${clientContact.phoneE164} is already connected to another client conversation in this channel`,
            });
          }
        }

        // Check WhatsApp number
        if (clientContact.whatsappE164) {
          const { available, existingConversation } = await isPhoneNumberAvailable(
            clientContact.whatsappE164,
            channelId,
            user.companyId
          );
          if (!available) {
            return next({
              statusCode: STATUS_CODES.BAD_REQUEST,
              message: `WhatsApp number ${clientContact.whatsappE164} is already connected to another client conversation in this channel`,
            });
          }
        }

        // Check email
        if (clientContact.email) {
          const { available, existingConversation } = await isEmailAvailable(
            clientContact.email,
            channelId,
            user.companyId
          );
          if (!available) {
            return next({
              statusCode: STATUS_CODES.BAD_REQUEST,
              message: `Email ${clientContact.email} is already connected to another client conversation in this channel`,
            });
          }
        }
      }

      // Resolve client conversation
      const { resolveConversation } = require("../models/chatConversationModel");
      const result = await resolveConversation(
        {
          companyId: user.companyId,
          type: "client",
          channelId,
          participantIds,
          clientContact: clientContact || null,
          createdBy: userId,
        },
        true // createIfMissing = true
      );

      return generateResponse(
        {
          conversation: result.conversation,
          created: result.created,
        },
        result.created
          ? "Client conversation created successfully"
          : "Client conversation found",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // ==================== DM / GROUP DM TYPES ====================
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
    const result = await resolveConversation(
      {
        companyId: user.companyId,
        type,
        participantIds,
        createdBy: userId,
      },
      true // createIfMissing = true
    );

    // Add chatName for dm and group_dm types
    let conversationWithChatName = result.conversation;
    if (type === "dm" || type === "group_dm") {
      const pipeline = getConversationWithChatName(
        result.conversation._id.toString(),
        userId
      );
      const enrichedConversations = await aggregateChatConversations(pipeline);
      if (enrichedConversations && enrichedConversations.length > 0) {
        conversationWithChatName = enrichedConversations[0];
      }
    }

    return generateResponse(
      {
        conversation: conversationWithChatName,
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

  // For client conversations, check Channel.members (client chat is channel-based)
  if (conversation.type === "client") {
    const { findChannel } = require("../models/channelModel");
    const channel = await findChannel({ _id: conversation.channelId });
    if (!channel) return false;

    return channel.members.some((memberId) => memberId.toString() === userId);
  }

  // For DM/Group DM, check participantIds
  return conversation.participantIds.some((id) => id.toString() === userId);
}
