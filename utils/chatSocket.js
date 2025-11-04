"use strict";

/**
 * Chat Socket Handlers
 * Handles all real-time chat functionality via Socket.IO
 */

const { Types } = require("mongoose");
const {
  findChatConversation,
  updateLastMessage,
  markAsRead,
} = require("../models/chatConversationModel");
const {
  createChatMessage,
  findChatMessage,
  editMessage,
  softDeleteMessage,
  incrementThreadCount,
} = require("../models/chatMessageModel");
const {
  addReaction,
  removeReaction,
  getReactionsByMessage,
} = require("../models/chatReactionModel");
const { findChannel } = require("../models/channelModel");
const { findUser } = require("../models/userModel");
const { createNotification } = require("../models/notificationModel");
const {
  validateAndSanitize,
  extractMentions,
  hasContent,
} = require("../services/chatContentValidator");
const {
  deriveContentText,
  extractLinks,
  generatePreview,
} = require("../services/chatContentProcessor");
const clientMessageRouter = require("../services/clientMessageRouter");

/**
 * Process: Send Message
 * Validates, saves, and broadcasts new messages (including thread replies)
 */
const processChatMessageSend = async (socket, data, io) => {
  const {
    conversationId,
    contentDoc,
    attachmentsUrls = [],
    attachmentsMeta = [],
    clientMsgId,
    parentMessageId = null,
    userId,
    // Client chat multi-channel delivery params (optional)
    deliveryModes = [],
    emailSubject,
    recipient = {},
    whatsappTemplate,
  } = data;

  try {
    // Validate required fields
    if (!conversationId || !contentDoc || !userId) {
      socket.emit("chat:message:error", {
        error: "Missing required fields: conversationId, contentDoc, userId",
        clientMsgId,
      });
      return;
    }

    // Check if message has content (text OR attachments)
    const hasTextContent = hasContent(contentDoc);
    const hasAttachments = attachmentsUrls && attachmentsUrls.length > 0;

    if (!hasTextContent && !hasAttachments) {
      socket.emit("chat:message:error", {
        error: "Message cannot be empty. Please add text or attach a file.",
        clientMsgId,
      });
      return;
    }

    // Find conversation and validate access
    const conversation = await findChatConversation({ _id: conversationId });
    if (!conversation) {
      socket.emit("chat:message:error", {
        error: "Conversation not found",
        clientMsgId,
      });
      return;
    }

    // Check user has access to conversation
    const hasAccess =
      conversation.type === "channel"
        ? await validateChannelAccess(conversation.channelId, userId)
        : conversation.participantIds.some(
            (id) => id.toString() === userId.toString()
          );

    if (!hasAccess) {
      socket.emit("chat:message:error", {
        error: "Access denied to this conversation",
        clientMsgId,
      });
      return;
    }

    // Validate client chat multi-channel delivery params
    if (conversation.type === "client" && deliveryModes.length > 0) {
      // Validate delivery modes
      const validChannels = ["board", "email", "sms", "whatsapp"];
      const invalidChannels = deliveryModes.filter(
        (mode) => !validChannels.includes(mode)
      );
      if (invalidChannels.length > 0) {
        socket.emit("chat:message:error", {
          error: `Invalid delivery channels: ${invalidChannels.join(", ")}`,
          clientMsgId,
        });
        return;
      }

      // Validate email delivery requirements
      if (deliveryModes.includes("email")) {
        if (!emailSubject || emailSubject.trim() === "") {
          socket.emit("chat:message:error", {
            error: "Email delivery requires emailSubject",
            clientMsgId,
          });
          return;
        }
        if (!recipient.email) {
          socket.emit("chat:message:error", {
            error: "Email delivery requires recipient.email",
            clientMsgId,
          });
          return;
        }
      }

      // Validate SMS delivery requirements
      if (deliveryModes.includes("sms")) {
        if (!recipient.phoneE164) {
          socket.emit("chat:message:error", {
            error: "SMS delivery requires recipient.phoneE164 in E.164 format",
            clientMsgId,
          });
          return;
        }
      }

      // Validate WhatsApp delivery requirements
      if (deliveryModes.includes("whatsapp")) {
        if (!recipient.whatsappE164) {
          socket.emit("chat:message:error", {
            error:
              "WhatsApp delivery requires recipient.whatsappE164 in E.164 format",
            clientMsgId,
          });
          return;
        }
      }
    }

    // Validate and sanitize contentDoc
    const validation = validateAndSanitize(contentDoc, {
      conversationType: conversation.type,
      conversationId,
    });

    if (!validation.isValid) {
      socket.emit("chat:message:error", {
        error: "Invalid message content",
        details: validation.errors,
        clientMsgId,
      });
      return;
    }

    // Derive text and extract links
    const contentText = deriveContentText(validation.sanitized);
    const links = extractLinks(validation.sanitized);
    const mentions = extractMentions(validation.sanitized);

    // Create message
    const messageData = {
      companyId: conversation.companyId,
      conversationId,
      authorId: userId,
      contentDoc: validation.sanitized,
      contentText,
      attachmentsUrls,
      attachmentsMeta,
      links,
      clientMsgId,
      parentMessageId,
      ...(emailSubject && { emailSubject }), // Add emailSubject for client chat email delivery
    };

    const message = await createChatMessage(messageData);

    // Client chat multi-channel delivery
    // Route message to external channels (email, SMS, WhatsApp) if requested
    if (conversation.type === "client" && deliveryModes.length > 0) {
      try {
        await clientMessageRouter.routeMessage({
          messageId: message._id.toString(),
          conversationId: conversation._id.toString(),
          deliveryModes,
          recipient,
          emailSubject,
          whatsappTemplate,
          content: validation.sanitized, // TipTap JSON content
          lastClientInboundAt: conversation.lastClientInboundAt,
          io,
          companyId: conversation.companyId.toString(),
        });
      } catch (routerError) {
        // Log error but don't fail the entire message send
        // Message is already saved to DB and will appear in board chat
        console.error("Client message router error:", routerError);

        // Emit error notification to sender
        socket.emit("chat:message:delivery:error", {
          messageId: message._id.toString(),
          error: routerError.message || "Failed to deliver to some channels",
        });
      }
    }

    // Populate author info
    const author = await findUser({ _id: userId });
    const populatedMessage = {
      ...message.toObject(),
      author: {
        _id: author._id,
        name: author.name,
        email: author.email,
        image: author.image,
      },
    };

    // Update conversation last message (only for root messages)
    if (!parentMessageId) {
      const preview = generatePreview(validation.sanitized, 100);
      await updateLastMessage(conversationId, preview, message.createdAt);
    }

    // Handle thread reply
    if (parentMessageId) {
      // Update thread aggregates on root message
      const replyPreview = generatePreview(validation.sanitized, 200);
      await incrementThreadCount(parentMessageId, {
        replyText: replyPreview,
        replyAuthorId: userId,
      });

      // Broadcast to thread room
      io.to(`thread:${parentMessageId}`).emit("chat:thread:message:new", {
        message: populatedMessage,
      });

      // Broadcast thread update to conversation room
      const rootMessage = await findChatMessage({ _id: parentMessageId });
      io.to(`conversation:${conversationId}`).emit("chat:thread:updated", {
        rootMessageId: parentMessageId,
        replyCount: rootMessage.replyCount,
        lastReplyAt: rootMessage.lastReplyAt,
        lastReplyText: rootMessage.lastReplyText,
        lastReplyAuthorId: rootMessage.lastReplyAuthorId,
      });
    } else {
      // Broadcast root message to conversation room
      io.to(`conversation:${conversationId}`).emit("chat:message:new", {
        message: populatedMessage,
      });
    }

    // Handle mentions and notifications
    await handleMentionNotifications(
      io,
      conversation,
      message,
      mentions,
      author,
      contentText
    );

    // Notify DM participants
    if (conversation.type === "dm" || conversation.type === "group_dm") {
      await notifyDMParticipants(
        io,
        conversation,
        message,
        userId,
        author,
        contentText
      );
    }

    // Notify channel members
    if (conversation.type === "channel") {
      await notifyChannelMembers(
        io,
        conversation,
        message,
        userId,
        author,
        contentText
      );
    }

    // Success response
    socket.emit("chat:message:sent", {
      success: true,
      message: populatedMessage,
      clientMsgId,
    });
  } catch (error) {
    console.error("Error sending chat message:", error);
    socket.emit("chat:message:error", {
      error: error.message,
      clientMsgId,
    });
  }
};

/**
 * Process: Edit Message
 */
const processChatMessageEdit = async (socket, data, io) => {
  const { messageId, contentDoc, attachmentsUrls, attachmentsMeta, userId } =
    data;

  try {
    if (!messageId || !contentDoc || !userId) {
      socket.emit("chat:message:error", {
        error: "Missing required fields: messageId, contentDoc, userId",
      });
      return;
    }

    // Find original message
    const originalMessage = await findChatMessage({ _id: messageId });
    if (!originalMessage) {
      socket.emit("chat:message:error", { error: "Message not found" });
      return;
    }

    // Get conversation for context
    const conversation = await findChatConversation({
      _id: originalMessage.conversationId,
    });

    // Validate contentDoc
    const validation = validateAndSanitize(contentDoc, {
      conversationType: conversation.type,
    });

    if (!validation.isValid) {
      socket.emit("chat:message:error", {
        error: "Invalid message content",
        details: validation.errors,
      });
      return;
    }

    // Check if edited message has content (text OR attachments)
    const hasTextContent = hasContent(validation.sanitized);
    const hasAttachments = attachmentsUrls && attachmentsUrls.length > 0;

    if (!hasTextContent && !hasAttachments) {
      socket.emit("chat:message:error", {
        error: "Message cannot be empty. Please add text or attach a file.",
      });
      return;
    }

    // Derive text and extract links
    const contentText = deriveContentText(validation.sanitized);
    const links = extractLinks(validation.sanitized);

    // Update message
    const updatedMessage = await editMessage(messageId, userId, {
      contentDoc: validation.sanitized,
      contentText,
      attachmentsUrls,
      attachmentsMeta,
      links,
    });

    // Populate author
    const author = await findUser({ _id: userId });
    const populatedMessage = {
      ...updatedMessage.toObject(),
      author: {
        _id: author._id,
        name: author.name,
        email: author.email,
        image: author.image,
      },
    };

    // Broadcast update
    io.to(`conversation:${originalMessage.conversationId}`).emit(
      "chat:message:updated",
      {
        message: populatedMessage,
      }
    );

    // Also broadcast to thread if it's a reply
    if (originalMessage.parentMessageId) {
      io.to(`thread:${originalMessage.parentMessageId}`).emit(
        "chat:message:updated",
        {
          message: populatedMessage,
        }
      );
    }

    socket.emit("chat:message:edited", {
      success: true,
      message: populatedMessage,
    });
  } catch (error) {
    console.error("Error editing message:", error);
    socket.emit("chat:message:error", { error: error.message });
  }
};

/**
 * Process: Delete Message
 */
const processChatMessageDelete = async (socket, data, io) => {
  const { messageId, userId } = data;

  try {
    if (!messageId || !userId) {
      socket.emit("chat:message:error", {
        error: "Missing required fields: messageId, userId",
      });
      return;
    }

    // Find message first
    const originalMessage = await findChatMessage({ _id: messageId });
    if (!originalMessage) {
      socket.emit("chat:message:error", { error: "Message not found" });
      return;
    }

    // Soft delete
    const deletedMessage = await softDeleteMessage(messageId, userId);

    // Populate author
    const author = await findUser({ _id: userId });
    const populatedMessage = {
      ...deletedMessage.toObject(),
      author: {
        _id: author._id,
        name: author.name,
        email: author.email,
        image: author.image,
      },
    };

    // Broadcast deletion
    io.to(`conversation:${originalMessage.conversationId}`).emit(
      "chat:message:updated",
      {
        message: populatedMessage,
      }
    );

    // Also broadcast to thread if it's a reply
    if (originalMessage.parentMessageId) {
      io.to(`thread:${originalMessage.parentMessageId}`).emit(
        "chat:message:updated",
        {
          message: populatedMessage,
        }
      );
    }

    socket.emit("chat:message:deleted", {
      success: true,
      messageId,
    });
  } catch (error) {
    console.error("Error deleting message:", error);
    socket.emit("chat:message:error", { error: error.message });
  }
};

/**
 * Process: Add Reaction
 */
const processChatReactionAdd = async (socket, data, io) => {
  const { messageId, emoji, userId } = data;

  try {
    if (!messageId || !emoji || !userId) {
      socket.emit("chat:reaction:error", {
        error: "Missing required fields: messageId, emoji, userId",
      });
      return;
    }

    // Find message
    const message = await findChatMessage({ _id: messageId });
    if (!message) {
      socket.emit("chat:reaction:error", { error: "Message not found" });
      return;
    }

    // Add reaction
    const { reaction, isNew } = await addReaction({ messageId, userId, emoji });

    // Get updated reaction counts
    const reactions = await getReactionsByMessage(messageId);

    // Broadcast to conversation
    io.to(`conversation:${message.conversationId}`).emit(
      "chat:reaction:updated",
      {
        messageId,
        reactions,
        action: "add",
        userId,
        emoji,
      }
    );

    // Also broadcast to thread if it's a reply
    if (message.parentMessageId) {
      io.to(`thread:${message.parentMessageId}`).emit("chat:reaction:updated", {
        messageId,
        reactions,
        action: "add",
        userId,
        emoji,
      });
    }

    socket.emit("chat:reaction:added", {
      success: true,
      messageId,
      emoji,
      isNew,
    });
  } catch (error) {
    console.error("Error adding reaction:", error);
    socket.emit("chat:reaction:error", { error: error.message });
  }
};

/**
 * Process: Remove Reaction
 */
const processChatReactionRemove = async (socket, data, io) => {
  const { messageId, emoji, userId } = data;

  try {
    if (!messageId || !emoji || !userId) {
      socket.emit("chat:reaction:error", {
        error: "Missing required fields: messageId, emoji, userId",
      });
      return;
    }

    // Find message
    const message = await findChatMessage({ _id: messageId });
    if (!message) {
      socket.emit("chat:reaction:error", { error: "Message not found" });
      return;
    }

    // Remove reaction
    await removeReaction({ messageId, userId, emoji });

    // Get updated reaction counts
    const reactions = await getReactionsByMessage(messageId);

    // Broadcast to conversation
    io.to(`conversation:${message.conversationId}`).emit(
      "chat:reaction:updated",
      {
        messageId,
        reactions,
        action: "remove",
        userId,
        emoji,
      }
    );

    // Also broadcast to thread if it's a reply
    if (message.parentMessageId) {
      io.to(`thread:${message.parentMessageId}`).emit("chat:reaction:updated", {
        messageId,
        reactions,
        action: "remove",
        userId,
        emoji,
      });
    }

    socket.emit("chat:reaction:removed", {
      success: true,
      messageId,
      emoji,
    });
  } catch (error) {
    console.error("Error removing reaction:", error);
    socket.emit("chat:reaction:error", { error: error.message });
  }
};

/**
 * Process: Mark as Read
 */
const processChatReadSync = async (socket, data, io) => {
  const { conversationId, userId } = data;

  try {
    if (!conversationId || !userId) {
      socket.emit("chat:read:error", {
        error: "Missing required fields: conversationId, userId",
      });
      return;
    }

    // Update read status
    const updatedConversation = await markAsRead(conversationId, userId, new Date());

    // Check if update was successful
    if (!updatedConversation) {
      console.error(
        `Failed to mark conversation ${conversationId} as read for user ${userId}: User not found in participants`
      );
      socket.emit("chat:read:error", {
        error: "Failed to update read status. You may not be a participant in this conversation.",
      });
      return;
    }

    // Broadcast to conversation
    io.to(`conversation:${conversationId}`).emit("chat:read:updated", {
      conversationId,
      userId,
      lastReadAt: new Date(),
    });

    socket.emit("chat:read:synced", {
      success: true,
      conversationId,
    });
  } catch (error) {
    console.error("Error syncing read status:", error);
    socket.emit("chat:read:error", { error: error.message });
  }
};

/**
 * Helper: Validate channel access
 */
const validateChannelAccess = async (channelId, userId) => {
  const channel = await findChannel({ _id: channelId });
  if (!channel) return false;
  return channel.members.some((id) => id.toString() === userId.toString());
};

/**
 * Helper: Handle mention notifications
 */
const handleMentionNotifications = async (
  io,
  conversation,
  message,
  mentions,
  author,
  contentText
) => {
  const { userMentions, channelMention } = mentions;

  // Handle @channel mention
  if (channelMention && conversation.type === "channel") {
    const channel = await findChannel({ _id: conversation.channelId });
    if (channel) {
      // Convert ObjectIds to strings for proper Socket.IO room targeting
      const memberIds = channel.members.map(id => id.toString());

      // Notify all channel members except author
      for (const memberId of memberIds) {
        if (memberId !== author._id.toString()) {
          // Emit to user room
          io.to(`user:${memberId}`).emit("chat:notification", {
            type: "CHAT_MENTION",
            conversationId: conversation._id,
            messageId: message._id,
            fromUser: {
              _id: author._id,
              name: author.name,
              image: author.image,
            },
            messagePreview: contentText.substring(0, 100),
            conversationType: conversation.type,
            mentionType: "channel",
            timestamp: new Date(),
          });

          // Create persistent notification
          await createNotification({
            userId: memberId,
            type: "CHAT_MENTION",
            title: `@channel in ${channel.channelName}`,
            message: `${author.name} mentioned everyone: ${contentText.substring(0, 100)}`,
            conversationId: conversation._id,
            messageId: message._id,
            createdBy: author._id,
          });
        }
      }
    }
  }

  // Handle user mentions
  if (userMentions.length > 0) {
    for (const mentionedUserId of userMentions) {
      if (mentionedUserId.toString() !== author._id.toString()) {
        // Emit to user room
        io.to(`user:${mentionedUserId}`).emit("chat:notification", {
          type: "CHAT_MENTION",
          conversationId: conversation._id,
          messageId: message._id,
          fromUser: {
            _id: author._id,
            name: author.name,
            image: author.image,
          },
          messagePreview: contentText.substring(0, 100),
          conversationType: conversation.type,
          mentionType: "user",
          timestamp: new Date(),
        });

        // Create persistent notification
        await createNotification({
          userId: mentionedUserId,
          type: "CHAT_MENTION",
          title: "New mention",
          message: `${author.name} mentioned you: ${contentText.substring(0, 100)}`,
          conversationId: conversation._id,
          messageId: message._id,
          createdBy: author._id,
        });
      }
    }
  }
};

/**
 * Helper: Notify DM participants
 */
const notifyDMParticipants = async (
  io,
  conversation,
  message,
  senderId,
  author,
  contentText
) => {
  // Get list of sockets in conversation room
  const socketsInRoom = await io.in(`conversation:${conversation._id}`).allSockets();

  for (const participantId of conversation.participantIds) {
    if (participantId.toString() !== senderId.toString()) {
      // Check if user is in conversation room (skip notification if they are)
      const userSocketRoom = `user:${participantId}`;
      const userSockets = await io.in(userSocketRoom).allSockets();

      // Only notify if user is not currently in the conversation room
      let isInConversation = false;
      for (const socketId of userSockets) {
        if (socketsInRoom.has(socketId)) {
          isInConversation = true;
          break;
        }
      }

      if (!isInConversation) {
        io.to(`user:${participantId}`).emit("chat:notification", {
          type: "CHAT_MESSAGE",
          conversationId: conversation._id,
          messageId: message._id,
          fromUser: {
            _id: author._id,
            name: author.name,
            image: author.image,
          },
          messagePreview: contentText.substring(0, 100),
          conversationType: conversation.type,
          timestamp: new Date(),
        });
      }
    }
  }
};

/**
 * Helper: Notify channel members
 */
const notifyChannelMembers = async (
  io,
  conversation,
  message,
  senderId,
  author,
  contentText
) => {
  // Get channel members
  const channel = await findChannel({ _id: conversation.channelId });
  if (!channel) {
    console.error(`Channel not found for conversation ${conversation._id}`);
    return;
  }

  // Get list of sockets in conversation room
  const socketsInRoom = await io.in(`conversation:${conversation._id}`).allSockets();

  // Convert ObjectIds to strings for proper Socket.IO room targeting
  const memberIds = channel.members.map(id => id.toString());

  for (const memberId of memberIds) {
    if (memberId !== senderId.toString()) {
      // Check if user is in conversation room (skip notification if they are)
      const userSocketRoom = `user:${memberId}`;
      const userSockets = await io.in(userSocketRoom).allSockets();

      // Only notify if user is not currently in the conversation room
      let isInConversation = false;
      for (const socketId of userSockets) {
        if (socketsInRoom.has(socketId)) {
          isInConversation = true;
          break;
        }
      }

      if (!isInConversation) {
        io.to(`user:${memberId}`).emit("chat:notification", {
          type: "CHAT_MESSAGE",
          conversationId: conversation._id,
          messageId: message._id,
          fromUser: {
            _id: author._id,
            name: author.name,
            image: author.image,
          },
          messagePreview: contentText.substring(0, 100),
          conversationType: conversation.type,
          timestamp: new Date(),
        });
      }
    }
  }
};

/**
 * Initialize chat socket handlers
 */
exports.initChatSocket = (io) => {
  io.on("connection", (socket) => {
    // Join conversation room
    socket.on("chat:join", async (data) => {
      try {
        const { conversationId, userId } = data;

        if (!conversationId) {
          console.error(`chat:join failed - missing conversationId from socket ${socket.id}`);
          socket.emit("chat:error", { error: "conversationId is required" });
          return;
        }

        // Validate conversationId format
        if (!Types.ObjectId.isValid(conversationId)) {
          console.error(`chat:join failed - invalid conversationId format: ${conversationId} from socket ${socket.id}`);
          socket.emit("chat:error", { error: "Invalid conversationId format" });
          return;
        }

        // Log detailed info
        console.log(`[chat:join] Socket ${socket.id} joining conversation: ${conversationId}${userId ? ` (user: ${userId})` : ''}`);

        // Check if conversation exists and get type for logging
        const conversation = await findChatConversation({ _id: conversationId });
        if (conversation) {
          console.log(`[chat:join] Conversation type: ${conversation.type}, channel: ${conversation.channelId || 'N/A'}`);
        } else {
          console.warn(`[chat:join] Conversation ${conversationId} not found in database, but allowing room join`);
        }

        // Join the room
        socket.join(`conversation:${conversationId}`);
        console.log(`[chat:join] ✓ Socket ${socket.id} successfully joined room: conversation:${conversationId}`);

        // Emit success response
        socket.emit("chat:joined", { conversationId, success: true });
        console.log(`[chat:join] ✓ Emitted chat:joined to socket ${socket.id}`);
      } catch (error) {
        console.error(`[chat:join] Error for socket ${socket.id}:`, error);
        socket.emit("chat:error", { error: `Failed to join conversation: ${error.message}` });
      }
    });

    // Leave conversation room
    socket.on("chat:leave", (data) => {
      const { conversationId } = data;
      if (!conversationId) return;
      console.log(`Socket ${socket.id} leaving conversation: ${conversationId}`);
      socket.leave(`conversation:${conversationId}`);
    });

    // Typing indicators
    socket.on("chat:typing:start", (data) => {
      const { conversationId, userId, userName } = data;
      if (!conversationId || !userId) return;
      socket.to(`conversation:${conversationId}`).emit("chat:typing", {
        conversationId,
        userId,
        userName,
        isTyping: true,
      });
    });

    socket.on("chat:typing:stop", (data) => {
      const { conversationId, userId, userName } = data;
      if (!conversationId || !userId) return;
      socket.to(`conversation:${conversationId}`).emit("chat:typing", {
        conversationId,
        userId,
        userName,
        isTyping: false,
      });
    });

    // Message operations
    socket.on("chat:message:send", async (data) => {
      await processChatMessageSend(socket, data, io);
    });

    socket.on("chat:message:edit", async (data) => {
      await processChatMessageEdit(socket, data, io);
    });

    socket.on("chat:message:delete", async (data) => {
      await processChatMessageDelete(socket, data, io);
    });

    // Reactions
    socket.on("chat:reaction:add", async (data) => {
      await processChatReactionAdd(socket, data, io);
    });

    socket.on("chat:reaction:remove", async (data) => {
      await processChatReactionRemove(socket, data, io);
    });

    // Read tracking
    socket.on("chat:read:sync", async (data) => {
      await processChatReadSync(socket, data, io);
    });

    // Thread rooms
    socket.on("chat:thread:join", (data) => {
      const { rootMessageId } = data;
      if (!rootMessageId) {
        socket.emit("chat:error", { error: "rootMessageId is required" });
        return;
      }
      console.log(`Socket ${socket.id} joining thread: ${rootMessageId}`);
      socket.join(`thread:${rootMessageId}`);
      socket.emit("chat:thread:joined", { rootMessageId, success: true });
    });

    socket.on("chat:thread:leave", (data) => {
      const { rootMessageId } = data;
      if (!rootMessageId) return;
      console.log(`Socket ${socket.id} leaving thread: ${rootMessageId}`);
      socket.leave(`thread:${rootMessageId}`);
    });
  });
};
