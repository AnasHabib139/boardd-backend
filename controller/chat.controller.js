"use strict";

const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findChatConversation, aggregateChatConversations } = require("../models/chatConversationModel");
const { getAllChatMessages, aggregateChatMessages } = require("../models/chatMessageModel");
const { getConversationMessagesQuery, getUserConversationsQuery, getConversationWithChatName, getClientContactInfoQuery, getMessageDatesQuery } = require("./queries/chatQueries");
const { aggregateChannelTabs } = require("../models/channelTabsModel");

/**
 * Get chat messages for a conversation
 * GET /api/chat/conversations/:conversationId/messages
 */
exports.getConversationMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { page, limit, parentMessageId, jumpToDate } = req.query;

    // Verify user is authenticated
    if (!req.user || !req.user.id) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    const userId = req.user.id.toString();

    // Validate jumpToDate format if provided
    if (jumpToDate && !/^\d{4}-\d{2}-\d{2}$/.test(jumpToDate)) {
      return next({
        statusCode: STATUS_CODES.UNPROCESSABLE_ENTITY,
        message: "jumpToDate must be in YYYY-MM-DD format",
      });
    }

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

    // Build aggregation query — pass jumpToDate to filter from start of that day
    const query = getConversationMessagesQuery(
      conversationId,
      parentMessageId || null,
      jumpToDate || null
    );

    // When jumping to a date, sort ascending so earliest messages of that day come first
    const sort = jumpToDate ? { createdAt: 1 } : { createdAt: -1 };

    // Get paginated messages
    const result = await getAllChatMessages({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      responseKey: "messages",
      sort,
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
      const clientInfoQuery = getClientContactInfoQuery(
        conversation.channelId.toString(),
        conversation.companyId.toString(),
        conversationId
      );
      const clientInfoResult = await aggregateChannelTabs(clientInfoQuery);

      if (clientInfoResult && clientInfoResult.length > 0) {
        responseData.conversationType = "client";
        responseData.messagingChannels = clientInfoResult[0].messagingChannels;
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
    const { type, participantIds, channelId, clientContact, twilioNumber } = req.body;
    const userId = req.user.id.toString();

    // Verify user is authenticated
    if (!req.user || !req.user.id) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not authenticated",
      });
    }

    // Validate input
    if (!type || !["dm", "group_dm", "client", "self"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Type must be either 'dm', 'group_dm', 'client', or 'self'",
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

    // ==================== SELF DETECTION (dm sent by frontend for self-talk) ====================
    // Two cases the frontend may send when user clicks themselves:
    //   Case 1: ["userId", "undefined"]  — one slot was unresolved
    //   Case 2: ["userId", "userId"]     — both slots resolved to same user
    // In both cases, after filtering out "undefined", all remaining IDs equal the current user.
    const isSelfDmRequest =
      type === "dm" &&
      Array.isArray(participantIds) &&
      participantIds.length > 0 &&
      participantIds.filter((id) => id !== "undefined").every((id) => id === userId);

    // ==================== SELF TYPE ====================
    if (type === "self" || isSelfDmRequest) {
      const { resolveConversation } = require("../models/chatConversationModel");
      const result = await resolveConversation(
        {
          companyId: user.companyId,
          type: "self",
          createdBy: userId,
        },
        true
      );

      return generateResponse(
        {
          conversation: {
            ...result.conversation.toObject(),
            chatName: `${user.name} - Notes to self`,
          },
          created: result.created,
        },
        result.created ? "Self conversation created successfully" : "Self conversation found",
        res,
        STATUS_CODES.SUCCESS
      );
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

      // Validate phone numbers and emails for uniqueness across the company.
      // SMS routing relies on (twilioNumber, clientPhone) being unique — a phone
      // attached to two channels would silently land in the wrong inbox on reply.
      if (clientContact) {
        const {
          isPhoneNumberAvailableInCompany,
          isEmailAvailable,
        } = require("../models/chatConversationModel");
        const { findChannel } = require("../models/channelModel");

        const buildPhoneConflictMessage = async (phone, existingConversation) => {
          const otherChannel = await findChannel({ _id: existingConversation.channelId });
          const channelName = otherChannel?.channelName || "another channel";
          return `Phone number ${phone} is already connected to client chat in channel "${channelName}". A phone number can only be used in one channel per company.`;
        };

        if (clientContact.phoneE164) {
          const { available, existingConversation } = await isPhoneNumberAvailableInCompany(
            clientContact.phoneE164,
            user.companyId
          );
          if (!available) {
            return next({
              statusCode: STATUS_CODES.BAD_REQUEST,
              message: await buildPhoneConflictMessage(clientContact.phoneE164, existingConversation),
            });
          }
        }

        if (clientContact.whatsappE164) {
          const { available, existingConversation } = await isPhoneNumberAvailableInCompany(
            clientContact.whatsappE164,
            user.companyId
          );
          if (!available) {
            return next({
              statusCode: STATUS_CODES.BAD_REQUEST,
              message: await buildPhoneConflictMessage(clientContact.whatsappE164, existingConversation),
            });
          }
        }

        if (clientContact.email) {
          const { available } = await isEmailAvailable(
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

      // Resolve which Twilio "from" number this client conversation will use.
      // If caller supplied one, it must be in company.twilioConfig.fromNumbers.
      // Otherwise default to fromNumbers[0] (preserves prior behavior).
      let resolvedTwilioNumber = null;
      const { findCompany } = require("../models/companyModel");
      const company = await findCompany({ _id: user.companyId });
      const fromNumbers = company?.twilioConfig?.fromNumbers || [];

      if (twilioNumber) {
        if (!fromNumbers.includes(twilioNumber)) {
          return next({
            statusCode: STATUS_CODES.BAD_REQUEST,
            message: `Twilio number ${twilioNumber} is not configured for this company`,
          });
        }
        resolvedTwilioNumber = twilioNumber;
      } else if (fromNumbers.length > 0) {
        resolvedTwilioNumber = fromNumbers[0];
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
          twilioNumber: resolvedTwilioNumber,
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
 * Update the Twilio "from" number used for outbound SMS on a client conversation.
 * PATCH /api/chat/conversations/:conversationId/twilio-number
 */
exports.updateConversationTwilioNumber = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { twilioNumber } = req.body;
    const userId = req.user.id.toString();

    const { findUser } = require("../models/userModel");
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const conversation = await findChatConversation({ _id: conversationId });
    if (!conversation) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Conversation not found",
      });
    }

    if (conversation.type !== "client") {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Twilio number can only be set on client conversations",
      });
    }

    if (conversation.companyId.toString() !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this conversation",
      });
    }

    const { findCompany } = require("../models/companyModel");
    const company = await findCompany({ _id: user.companyId });
    const fromNumbers = company?.twilioConfig?.fromNumbers || [];
    if (!fromNumbers.includes(twilioNumber)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Twilio number ${twilioNumber} is not configured for this company`,
      });
    }

    const { updateClientTwilioNumber } = require("../models/chatConversationModel");
    const updated = await updateClientTwilioNumber(
      conversationId,
      twilioNumber,
      user.companyId
    );

    return generateResponse(
      { conversation: updated },
      "Twilio number updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateConversationTwilioNumber:", error);
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

    // Inject self entry at the top (page 1 only)
    if (pageNum === 1) {
      const { Types: MongoTypes } = require("mongoose");
      const selfConvo = await findChatConversation({
        companyId: user.companyId,
        type: "self",
        "participants.userId": new MongoTypes.ObjectId(userId),
      });

      const selfEntry = {
        _id: selfConvo ? selfConvo._id : null,
        type: "self",
        chatName: `${user.name} - Notes to self`,
        isSelf: true,
        lastMessageAt: selfConvo ? selfConvo.lastMessageAt : null,
        lastMessageText: selfConvo ? selfConvo.lastMessageText : "",
        unreadCount: 0,
        createdAt: selfConvo ? selfConvo.createdAt : null,
        updatedAt: selfConvo ? selfConvo.updatedAt : null,
        participants: [
          {
            _id: user._id,
            name: user.name,
            email: user.email,
            image: user.image || null,
            coverImage: user.coverImage || null,
            nickname: user.nickname || null,
            dob: user.dob || null,
            gender: user.gender || null,
            title: user.title || null,
            designation: user.designation || null,
            description: user.description || null,
          },
        ],
      };

      data.conversations = [selfEntry, ...data.conversations];
    }

    // Enrich participants with real-time online status from Redis
    try {
      const { getOnlineStatuses } = require("../utils/redis");

      const participantIds = new Set();
      data.conversations.forEach((conv) => {
        conv.participants?.forEach((p) => {
          if (p._id) participantIds.add(p._id.toString());
        });
      });

      if (participantIds.size > 0) {
        const onlineMap = await getOnlineStatuses([...participantIds]);
        data.conversations = data.conversations.map((conv) => ({
          ...conv,
          participants: conv.participants?.map((p) => ({
            ...p,
            isOnline: conv.isSelf ? true : (onlineMap[p._id.toString()] || false),
          })),
        }));
      }
    } catch (err) {
      console.error("Failed to enrich isOnline:", err);
      // Non-fatal — conversations return without isOnline rather than failing
    }

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
 * Get days-of-month that have at least one message in a conversation.
 * GET /api/chat/conversations/:conversationId/message-dates?year=2025&month=5
 */
exports.getMessageDates = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { year, month } = req.query;

    const userId = req.user.id.toString();

    const conversation = await findChatConversation({ _id: conversationId });
    if (!conversation) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Conversation not found" });
    }

    const hasAccess = await verifyConversationAccess(conversation, userId);
    if (!hasAccess) {
      return next({ statusCode: STATUS_CODES.FORBIDDEN, message: "You don't have access to this conversation" });
    }

    const pipeline = getMessageDatesQuery(conversationId, Number(year), Number(month));
    const result = await aggregateChatMessages(pipeline);

    const dates = result.length > 0 ? result[0].dates : [];

    return generateResponse(
      { dates, year: Number(year), month: Number(month) },
      "Message dates fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
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
