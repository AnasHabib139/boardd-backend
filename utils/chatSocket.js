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
  countChatMessages,
  findLatestRootMessage,
} = require("../models/chatMessageModel");
const {
  addReaction,
  removeReaction,
  getReactionsByMessage,
  removeAllReactionsForMessage,
} = require("../models/chatReactionModel");
const { findChannel } = require("../models/channelModel");
const { findUser } = require("../models/userModel");
const { createNotification } = require("../models/notificationModel");
const { emitUnreadCountsUpdate } = require("./activityNotifications");
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
      conversation.type === "channel" || conversation.type === "client"
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
        coverImage: author.coverImage,
        role: author.role,
        designation: author.designation,
        title: author.title,
      },
    };

    // Update conversation last message (only for root messages)
    if (!parentMessageId) {
      let preview = generatePreview(validation.sanitized, 100);

      // If no text content but has attachments, show attachment type
      if (!preview && attachmentsMeta && attachmentsMeta.length > 0) {
        const firstAttachment = attachmentsMeta[0];
        switch (firstAttachment.type) {
          case 'audio':
            preview = '🎵 Audio message';
            break;
          case 'video':
            preview = '🎬 Video';
            break;
          case 'image':
            preview = '📷 Photo';
            break;
          case 'gif':
            preview = '🎭 GIF';
            break;
          case 'document':
          default:
            preview = '📎 File';
            break;
        }
        // If multiple attachments of same type
        if (attachmentsMeta.length > 1) {
          const sameType = attachmentsMeta.every(a => a.type === firstAttachment.type);
          if (sameType) {
            preview = `${preview} (${attachmentsMeta.length})`;
          } else {
            preview = `📎 ${attachmentsMeta.length} attachments`;
          }
        }
      }

      await updateLastMessage(conversationId, preview, message.createdAt);
    }

    // Handle thread reply
    if (parentMessageId) {
      // Update thread aggregates on root message
      let replyPreview = generatePreview(validation.sanitized, 200);

      // If no text content but has attachments, show attachment type
      if (!replyPreview && attachmentsMeta && attachmentsMeta.length > 0) {
        const firstAttachment = attachmentsMeta[0];
        switch (firstAttachment.type) {
          case 'audio':
            replyPreview = '🎵 Audio message';
            break;
          case 'video':
            replyPreview = '🎬 Video';
            break;
          case 'image':
            replyPreview = '📷 Photo';
            break;
          case 'gif':
            replyPreview = '🎭 GIF';
            break;
          case 'document':
          default:
            replyPreview = '📎 File';
            break;
        }
        if (attachmentsMeta.length > 1) {
          const sameType = attachmentsMeta.every(a => a.type === firstAttachment.type);
          if (sameType) {
            replyPreview = `${replyPreview} (${attachmentsMeta.length})`;
          } else {
            replyPreview = `📎 ${attachmentsMeta.length} attachments`;
          }
        }
      }

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

    // Handle mentions (works for both root messages and thread replies)
    await handleMentionNotifications(
      io,
      conversation,
      message,
      mentions,
      author,
      contentText
    );

    // Handle notifications based on message type
    if (parentMessageId) {
      // Thread reply - notify only thread participants (root author + previous repliers)
      await notifyThreadParticipants(
        io,
        conversation,
        message,
        parentMessageId,
        userId,
        author,
        contentText
      );
    } else {
      // Root message - notify all conversation participants

      // Notify DM participants (including client chat)
      if (conversation.type === "dm" || conversation.type === "group_dm" || conversation.type === "client") {
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
    }

    // Emit unread count updates to participants
    await emitUnreadCountUpdates(io, conversation, message, userId);

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
        coverImage: author.coverImage,
        role: author.role,
        designation: author.designation,
        title: author.title,
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

    // Soft delete and remove reactions
    const deletedMessage = await softDeleteMessage(messageId, userId);
    await removeAllReactionsForMessage(messageId);

    // Update sidebar preview if this was a root message
    if (!originalMessage.parentMessageId) {
      const latestMessage = await findLatestRootMessage(
        originalMessage.conversationId,
        messageId
      );
      if (latestMessage) {
        await updateLastMessage(
          originalMessage.conversationId,
          latestMessage.contentText || "",
          latestMessage.createdAt
        );
      } else {
        await updateLastMessage(originalMessage.conversationId, "", new Date());
      }
    }

    // Populate author
    const author = await findUser({ _id: userId });
    const populatedMessage = {
      ...deletedMessage.toObject(),
      author: {
        _id: author._id,
        name: author.name,
        email: author.email,
        image: author.image,
        coverImage: author.coverImage,
        role: author.role,
        designation: author.designation,
        title: author.title,
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

    // ========== Create Reaction Notification ==========
    // Only notify if reactor is not the message author
    if (message.authorId.toString() !== userId.toString()) {
      try {
        // Fetch reactor user info
        const reactor = await findUser({ _id: userId });
        if (!reactor) {
          console.error("Reactor user not found:", userId);
        } else {
          // Fetch conversation to get context
          const conversation = await findChatConversation({
            _id: message.conversationId,
          });

          if (conversation) {
            let channelName = null;

            // Get channel name if conversation is channel type
            if (conversation.type === "channel" && conversation.channelId) {
              const channel = await findChannel({ _id: conversation.channelId });
              channelName = channel?.channelName || null;
            }

            // Create notification
            const notification = await createNotification({
              userId: message.authorId,
              type: "CHAT_REACTION",
              activityCategory: "reaction",
              title: "New reaction",
              message: `${reactor.name} reacted ${emoji} to your message`,
              channelId: conversation.channelId || null,
              channelName: channelName,
              conversationId: message.conversationId,
              conversationType: conversation.type,
              messageId: message._id,
              reactionEmoji: emoji,
              createdBy: userId,
              aggregationKey: `reaction:${messageId}:${emoji}`, // For future aggregation
            });

            // Emit real-time activity update to message author
            io.to(`user:${message.authorId}`).emit("activity:new", {
              _id: notification._id,
              type: "CHAT_REACTION",
              activityCategory: "reaction",
              subtitle: channelName
                ? `reaction in ${channelName}`
                : conversation.type === "dm"
                ? "reaction in Direct Message"
                : conversation.type === "group_dm"
                ? "reaction in Group Chat"
                : conversation.type === "client"
                ? "reaction in Client Chat"
                : "reaction",
              title: "New reaction",
              messagePreview: `${reactor.name} reacted ${emoji} to your message`,
              actor: {
                _id: reactor._id,
                name: reactor.name,
                email: reactor.email,
                image: reactor.image,
              },
              reactionEmoji: emoji,
              timestamp: notification.timestamp,
              isRead: false,
              navigationContext: {
                conversationId: message.conversationId,
                messageId: message._id,
                channelId: conversation.channelId || null,
              },
            });

            // Emit updated unread counts
            await emitUnreadCountsUpdate(message.authorId.toString(), io);
          }
        }
      } catch (notificationError) {
        // Don't fail the reaction if notification fails
        console.error(
          "Error creating reaction notification:",
          notificationError
        );
      }
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

    // ========== Sync: Mark related activity feed notifications as read ==========
    // When user marks conversation as read, also mark all chat notifications for that conversation as read
    try {
      const { model } = require("mongoose");
      const NotificationModel = model("Notification");

      const result = await NotificationModel.updateMany(
        {
          userId: new Types.ObjectId(userId),
          conversationId: new Types.ObjectId(conversationId),
          type: { $in: ["CHAT_MESSAGE", "CHAT_MENTION", "CHAT_THREAD_REPLY", "CHAT_REACTION"] },
          isRead: false,
        },
        { $set: { isRead: true } }
      );

      // Emit updated activity unread counts if any notifications were marked as read
      if (result.modifiedCount > 0) {
        await emitUnreadCountsUpdate(userId.toString(), io);
      }
    } catch (notifError) {
      console.error("Error syncing activity notifications read status:", notifError);
      // Don't fail the read sync if notification update fails
    }

    // Broadcast to conversation
    io.to(`conversation:${conversationId}`).emit("chat:read:updated", {
      conversationId,
      userId,
      lastReadAt: new Date(),
    });

    // Emit unread count update to user (always 0 after marking as read)
    io.to(`user:${userId}`).emit("chat:unread:updated", {
      conversationId,
      unreadCount: 0,
      lastMessageAt: updatedConversation.lastMessageAt,
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
  const { userMentions, channelMention, allMention } = mentions;

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
          const notification = await createNotification({
            userId: memberId,
            type: "CHAT_MENTION",
            activityCategory: "mention",
            conversationType: conversation.type,
            channelName: channel.channelName,
            title: `@channel in ${channel.channelName}`,
            message: `${author.name} mentioned everyone: ${contentText.substring(0, 100)}`,
            channelId: conversation.channelId,
            conversationId: conversation._id,
            messageId: message._id,
            createdBy: author._id,
          });

          // Emit real-time activity update
          io.to(`user:${memberId}`).emit("activity:new", {
            _id: notification._id,
            type: "CHAT_MENTION",
            activityCategory: "mention",
            subtitle: `mention in ${channel.channelName}`,
            title: `@channel in ${channel.channelName}`,
            messagePreview: `${author.name} mentioned everyone: ${contentText.substring(0, 100)}`,
            actor: {
              _id: author._id,
              name: author.name,
              email: author.email,
              image: author.image,
            },
            conversationType: conversation.type,
            channelName: channel.channelName,
            timestamp: notification.timestamp,
            isRead: false,
            navigationContext: {
              conversationId: conversation._id,
              messageId: message._id,
              channelId: conversation.channelId,
              projectId: null,
              taskId: null,
              tabId: null,
            },
          });

          // Emit updated unread counts
          await emitUnreadCountsUpdate(memberId.toString(), io);
        }
      }
    }
  }

  // Handle @all mention in client and group_dm conversations
  if (allMention && (conversation.type === "client" || conversation.type === "group_dm")) {
    // These conversation types use participantIds
    const participantIds = conversation.participantIds.map(id => id.toString());

    // Determine conversation name for notification
    let conversationName;
    if (conversation.type === "client") {
      conversationName = conversation.clientContact?.name || "Client Chat";
    } else {
      conversationName = "Group Chat";
    }

    // Notify all participants except author
    for (const participantId of participantIds) {
      if (participantId !== author._id.toString()) {
        // Emit to user room
        io.to(`user:${participantId}`).emit("chat:notification", {
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
          mentionType: "all",
          timestamp: new Date(),
        });

        // Create persistent notification
        const notification = await createNotification({
          userId: participantId,
          type: "CHAT_MENTION",
          activityCategory: "mention",
          conversationType: conversation.type,
          title: `@all in ${conversationName}`,
          message: `${author.name} mentioned everyone: ${contentText.substring(0, 100)}`,
          conversationId: conversation._id,
          messageId: message._id,
          createdBy: author._id,
        });

        // Emit real-time activity update
        const subtitle = conversation.type === "client"
          ? "mention in Client Chat"
          : conversation.type === "group_dm"
          ? "mention in Group Chat"
          : "mention";

        io.to(`user:${participantId}`).emit("activity:new", {
          _id: notification._id,
          type: "CHAT_MENTION",
          activityCategory: "mention",
          subtitle: subtitle,
          title: `@all in ${conversationName}`,
          messagePreview: `${author.name} mentioned everyone: ${contentText.substring(0, 100)}`,
          actor: {
            _id: author._id,
            name: author.name,
            email: author.email,
            image: author.image,
          },
          conversationType: conversation.type,
          timestamp: notification.timestamp,
          isRead: false,
          navigationContext: {
            conversationId: conversation._id,
            messageId: message._id,
            channelId: null,
            projectId: null,
            taskId: null,
            tabId: null,
          },
        });

        // Emit updated unread counts
        await emitUnreadCountsUpdate(participantId.toString(), io);
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
        // Get channelName if this is a channel conversation
        let channelName = null;
        if (conversation.type === "channel" && conversation.channelId) {
          const channel = await findChannel({ _id: conversation.channelId });
          channelName = channel?.channelName || null;
        }

        const notification = await createNotification({
          userId: mentionedUserId,
          type: "CHAT_MENTION",
          activityCategory: "mention",
          conversationType: conversation.type,
          channelName: channelName,
          title: "New mention",
          message: `${author.name} mentioned you: ${contentText.substring(0, 100)}`,
          channelId: conversation.channelId || null,
          conversationId: conversation._id,
          messageId: message._id,
          createdBy: author._id,
        });

        // Emit real-time activity update
        let subtitle;
        if (channelName) {
          subtitle = `mention in ${channelName}`;
        } else {
          switch (conversation.type) {
            case "dm":
              subtitle = "mention in Direct Message";
              break;
            case "group_dm":
              subtitle = "mention in Group Chat";
              break;
            case "client":
              subtitle = "mention in Client Chat";
              break;
            default:
              subtitle = "mention";
          }
        }

        io.to(`user:${mentionedUserId}`).emit("activity:new", {
          _id: notification._id,
          type: "CHAT_MENTION",
          activityCategory: "mention",
          subtitle: subtitle,
          title: "New mention",
          messagePreview: `${author.name} mentioned you: ${contentText.substring(0, 100)}`,
          actor: {
            _id: author._id,
            name: author.name,
            email: author.email,
            image: author.image,
          },
          conversationType: conversation.type,
          channelName: channelName,
          timestamp: notification.timestamp,
          isRead: false,
          navigationContext: {
            conversationId: conversation._id,
            messageId: message._id,
            channelId: conversation.channelId || null,
            projectId: null,
            taskId: null,
            tabId: null,
          },
        });

        // Emit updated unread counts
        await emitUnreadCountsUpdate(mentionedUserId.toString(), io);
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
  // Determine which room to check based on message type
  let roomToCheck;
  if (message.parentMessageId) {
    // For thread replies, check if user is in THIS specific thread
    roomToCheck = `thread:${message.parentMessageId}`;
  } else {
    // For root messages, check if user is in conversation
    roomToCheck = `conversation:${conversation._id}`;
  }

  // Get list of sockets in the appropriate room
  const socketsInRoom = await io.in(roomToCheck).allSockets();

  for (const participantId of conversation.participantIds) {
    if (participantId.toString() !== senderId.toString()) {
      // Check if user is in the room (skip notification if they are)
      const userSocketRoom = `user:${participantId}`;
      const userSockets = await io.in(userSocketRoom).allSockets();

      // Only notify if user is not currently in the room
      let isInRoom = false;
      for (const socketId of userSockets) {
        if (socketsInRoom.has(socketId)) {
          isInRoom = true;
          break;
        }
      }

      if (!isInRoom) {
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

      // Create persistent activity feed notification (ALWAYS, even if user is viewing)
      // Will be auto-marked as read when conversation is viewed via read sync
      const notification = await createNotification({
        userId: participantId,
        type: "CHAT_MESSAGE",
        activityCategory: "chat",
        conversationType: conversation.type,
        title: "New message",
        message: `${author.name}: ${contentText.substring(0, 100)}`,
        conversationId: conversation._id,
        messageId: message._id,
        createdBy: author._id,
      });

      // Emit real-time activity update
      let subtitle;
      switch (conversation.type) {
        case "dm":
          subtitle = "Direct Message";
          break;
        case "group_dm":
          subtitle = "Group Message";
          break;
        case "client":
          subtitle = "Client Message";
          break;
        default:
          subtitle = "New message";
      }

      io.to(`user:${participantId}`).emit("activity:new", {
        _id: notification._id,
        type: "CHAT_MESSAGE",
        activityCategory: "chat",
        subtitle: subtitle,
        title: "New message",
        messagePreview: `${author.name}: ${contentText.substring(0, 100)}`,
        actor: {
          _id: author._id,
          name: author.name,
          email: author.email,
          image: author.image,
        },
        conversationType: conversation.type,
        timestamp: notification.timestamp,
        isRead: false,
        navigationContext: {
          conversationId: conversation._id,
          messageId: message._id,
          channelId: null,
          projectId: null,
          taskId: null,
          tabId: null,
        },
      });

      // Emit updated unread counts
      await emitUnreadCountsUpdate(participantId.toString(), io);
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

  // Determine which room to check based on message type
  let roomToCheck;
  if (message.parentMessageId) {
    // For thread replies, check if user is in THIS specific thread
    roomToCheck = `thread:${message.parentMessageId}`;
  } else {
    // For root messages, check if user is in conversation
    roomToCheck = `conversation:${conversation._id}`;
  }

  // Get list of sockets in the appropriate room
  const socketsInRoom = await io.in(roomToCheck).allSockets();

  // Convert ObjectIds to strings for proper Socket.IO room targeting
  const memberIds = channel.members.map(id => id.toString());

  for (const memberId of memberIds) {
    if (memberId !== senderId.toString()) {
      // Check if user is in the room (skip notification if they are)
      const userSocketRoom = `user:${memberId}`;
      const userSockets = await io.in(userSocketRoom).allSockets();

      // Only notify if user is not currently in the room
      let isInRoom = false;
      for (const socketId of userSockets) {
        if (socketsInRoom.has(socketId)) {
          isInRoom = true;
          break;
        }
      }

      if (!isInRoom) {
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

      // Create persistent activity feed notification (ALWAYS, even if user is viewing)
      // Will be auto-marked as read when conversation is viewed via read sync
      const notification = await createNotification({
        userId: memberId,
        type: "CHAT_MESSAGE",
        activityCategory: "chat",
        conversationType: conversation.type,
        channelName: channel.channelName,
        title: "New message",
        message: `${author.name} in ${channel.channelName}: ${contentText.substring(0, 100)}`,
        conversationId: conversation._id,
        messageId: message._id,
        channelId: channel._id,
        createdBy: author._id,
      });

      // Emit real-time activity update
      io.to(`user:${memberId}`).emit("activity:new", {
        _id: notification._id,
        type: "CHAT_MESSAGE",
        activityCategory: "chat",
        subtitle: `message in ${channel.channelName}`,
        title: "New message",
        messagePreview: `${author.name} in ${channel.channelName}: ${contentText.substring(0, 100)}`,
        actor: {
          _id: author._id,
          name: author.name,
          email: author.email,
          image: author.image,
        },
        conversationType: conversation.type,
        channelName: channel.channelName,
        timestamp: notification.timestamp,
        isRead: false,
        navigationContext: {
          conversationId: conversation._id,
          messageId: message._id,
          channelId: channel._id,
          projectId: null,
          taskId: null,
          tabId: null,
        },
      });

      // Emit updated unread counts
      await emitUnreadCountsUpdate(memberId.toString(), io);
    }
  }
};

/**
 * Helper: Notify thread participants
 * Notifies root message author and users who have replied to the thread
 */
const notifyThreadParticipants = async (
  io,
  conversation,
  message,
  parentMessageId,
  senderId,
  author,
  contentText
) => {
  // Fetch root message to get author and thread participants
  const rootMessage = await findChatMessage({ _id: parentMessageId });
  if (!rootMessage) {
    console.error(`Root message ${parentMessageId} not found for thread reply notification`);
    return;
  }

  // Get list of sockets in THIS specific thread room
  const socketsInRoom = await io.in(`thread:${parentMessageId}`).allSockets();

  // Collect users to notify: root author + thread participants
  const usersToNotify = new Set();

  // Add root message author (if not the reply author)
  if (rootMessage.authorId.toString() !== senderId.toString()) {
    usersToNotify.add(rootMessage.authorId.toString());
  }

  // Add thread participants (if any)
  if (rootMessage.threadParticipants && rootMessage.threadParticipants.length > 0) {
    rootMessage.threadParticipants.forEach((participantId) => {
      if (participantId.toString() !== senderId.toString()) {
        usersToNotify.add(participantId.toString());
      }
    });
  }

  // Notify each user
  for (const userId of usersToNotify) {
    // Check if user is currently viewing this thread (skip notification if they are)
    const userSocketRoom = `user:${userId}`;
    const userSockets = await io.in(userSocketRoom).allSockets();

    let isInThread = false;
    for (const socketId of userSockets) {
      if (socketsInRoom.has(socketId)) {
        isInThread = true;
        break;
      }
    }

    if (!isInThread) {
      // Emit notification
      io.to(`user:${userId}`).emit("chat:notification", {
        type: "CHAT_THREAD_REPLY",
        conversationId: conversation._id,
        messageId: message._id,
        parentMessageId: parentMessageId,
        fromUser: {
          _id: author._id,
          name: author.name,
          image: author.image,
        },
        messagePreview: contentText.substring(0, 100),
        conversationType: conversation.type,
        timestamp: new Date(),
      });

      // Create persistent notification
      // Get channelName if this is a channel conversation
      let channelName = null;
      if (conversation.type === "channel" && conversation.channelId) {
        const channel = await findChannel({ _id: conversation.channelId });
        channelName = channel?.channelName || null;
      }

      const notification = await createNotification({
        userId: userId,
        type: "CHAT_THREAD_REPLY",
        activityCategory: "chat",
        conversationType: conversation.type,
        channelName: channelName,
        title: "New thread reply",
        message: `${author.name} replied: ${contentText.substring(0, 100)}`,
        channelId: conversation.channelId || null,
        conversationId: conversation._id,
        messageId: message._id,
        createdBy: author._id,
      });

      // Emit real-time activity update
      let subtitle;
      if (channelName) {
        subtitle = `reply in ${channelName}`;
      } else {
        switch (conversation.type) {
          case "dm":
            subtitle = "reply in Direct Message";
            break;
          case "group_dm":
            subtitle = "reply in Group Chat";
            break;
          case "client":
            subtitle = "reply in Client Chat";
            break;
          default:
            subtitle = "thread reply";
        }
      }

      io.to(`user:${userId}`).emit("activity:new", {
        _id: notification._id,
        type: "CHAT_THREAD_REPLY",
        activityCategory: "chat",
        subtitle: subtitle,
        title: "New thread reply",
        messagePreview: `${author.name} replied: ${contentText.substring(0, 100)}`,
        actor: {
          _id: author._id,
          name: author.name,
          email: author.email,
          image: author.image,
        },
        conversationType: conversation.type,
        channelName: channelName,
        timestamp: notification.timestamp,
        isRead: false,
        navigationContext: {
          conversationId: conversation._id,
          messageId: message._id,
          channelId: conversation.channelId || null,
          projectId: null,
          taskId: null,
          tabId: null,
        },
      });

      // Emit updated unread counts
      await emitUnreadCountsUpdate(userId.toString(), io);
    }
  }
};

/**
 * Helper: Calculate unread count for a user in a conversation
 * @param {String} conversationId
 * @param {String} userId
 * @returns {Promise<Number>} Unread count
 */
const calculateUnreadCount = async (conversationId, userId) => {
  // Get conversation to find user's lastReadAt
  const conversation = await findChatConversation({ _id: conversationId });
  if (!conversation) return 0;

  // Find participant's lastReadAt
  const participant = conversation.participants?.find(
    (p) => p.userId.toString() === userId.toString()
  );

  // Build query to count unread messages
  const query = {
    conversationId: new Types.ObjectId(conversationId),
    authorId: { $ne: new Types.ObjectId(userId) }, // Exclude user's own messages
    deletedAt: null, // Exclude deleted messages
  };

  // If user has read before, only count messages after lastReadAt
  if (participant?.lastReadAt) {
    query.createdAt = { $gt: participant.lastReadAt };
  }

  // Count unread messages
  return await countChatMessages(query);
};

/**
 * Helper: Emit unread count updates to conversation participants
 * Calculates and emits updated unread counts after a new message
 */
const emitUnreadCountUpdates = async (
  io,
  conversation,
  message,
  senderId
) => {
  try {
    // Get participant IDs based on conversation type
    let participantIds = [];

    if (conversation.type === "dm" || conversation.type === "group_dm" || conversation.type === "client") {
      // DM, Group DM, and Client use participantIds
      participantIds = conversation.participantIds.map((id) => id.toString());
    } else if (conversation.type === "channel") {
      // Channels get members from channel document
      const channel = await findChannel({ _id: conversation.channelId });
      if (channel) {
        participantIds = channel.members.map((id) => id.toString());
      }
    }

    // Determine which room to check (conversation or thread)
    let roomToCheck;
    if (message.parentMessageId) {
      // For thread replies, check if user is in THIS specific thread
      roomToCheck = `thread:${message.parentMessageId}`;
    } else {
      // For root messages, check if user is in conversation
      roomToCheck = `conversation:${conversation._id}`;
    }

    // Get sockets currently in the room
    const socketsInRoom = await io.in(roomToCheck).allSockets();

    // Update each participant (except sender)
    for (const participantId of participantIds) {
      if (participantId === senderId.toString()) continue; // Skip sender

      // Check if user is actively viewing the conversation/thread
      const userSocketRoom = `user:${participantId}`;
      const userSockets = await io.in(userSocketRoom).allSockets();

      let isActivelyViewing = false;
      for (const socketId of userSockets) {
        if (socketsInRoom.has(socketId)) {
          isActivelyViewing = true;
          break;
        }
      }

      // Only emit if user is NOT actively viewing
      if (!isActivelyViewing) {
        // Calculate accurate unread count
        const unreadCount = await calculateUnreadCount(
          conversation._id,
          participantId
        );

        // Emit to user's personal room
        io.to(`user:${participantId}`).emit("chat:unread:updated", {
          conversationId: conversation._id,
          unreadCount: unreadCount,
          lastMessageAt: message.createdAt,
        });
      }
    }
  } catch (error) {
    console.error("Error emitting unread count updates:", error);
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
