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

    // Check if message has content
    if (!hasContent(contentDoc)) {
      socket.emit("chat:message:error", {
        error: "Message cannot be empty",
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
    };

    const message = await createChatMessage(messageData);

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
    await markAsRead(conversationId, userId, new Date());

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
      // Notify all channel members except author
      for (const memberId of channel.members) {
        if (memberId.toString() !== author._id.toString()) {
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
 * Initialize chat socket handlers
 */
exports.initChatSocket = (io) => {
  io.on("connection", (socket) => {
    // Join conversation room
    socket.on("chat:join", (data) => {
      const { conversationId } = data;
      if (!conversationId) {
        socket.emit("chat:error", { error: "conversationId is required" });
        return;
      }
      console.log(`Socket ${socket.id} joining conversation: ${conversationId}`);
      socket.join(`conversation:${conversationId}`);
      socket.emit("chat:joined", { conversationId, success: true });
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
