"use strict";

const { Types } = require("mongoose");

/**
 * Get chat messages for a conversation
 * Returns messages in reverse chronological order (latest first)
 * @param {string} conversationId - Conversation ID
 * @param {string|null} parentMessageId - Optional parent message ID for thread replies
 * @returns {Array} Aggregation pipeline
 */
exports.getConversationMessagesQuery = (conversationId, parentMessageId = null) => {
  const matchStage = {
    conversationId: Types.ObjectId.isValid(conversationId)
      ? new Types.ObjectId(conversationId)
      : null,
  };

  // Filter by parentMessageId for threads, or null for main conversation
  if (parentMessageId) {
    matchStage.parentMessageId = Types.ObjectId.isValid(parentMessageId)
      ? new Types.ObjectId(parentMessageId)
      : null;
  } else {
    matchStage.parentMessageId = null; // Only root messages
  }

  return [
    {
      $match: matchStage,
    },

    // Lookup author details
    {
      $lookup: {
        from: "users",
        localField: "authorId",
        foreignField: "_id",
        as: "author",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              image: 1,
            },
          },
        ],
      },
    },

    // Unwind author (should always be one)
    {
      $unwind: {
        path: "$author",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Lookup reactions for each message
    {
      $lookup: {
        from: "chatreactions",
        localField: "_id",
        foreignField: "messageId",
        as: "reactionsRaw",
      },
    },

    // Group reactions by emoji
    {
      $addFields: {
        reactions: {
          $map: {
            input: {
              $setUnion: ["$reactionsRaw.emoji"],
            },
            as: "emoji",
            in: {
              emoji: "$$emoji",
              count: {
                $size: {
                  $filter: {
                    input: "$reactionsRaw",
                    as: "r",
                    cond: { $eq: ["$$r.emoji", "$$emoji"] },
                  },
                },
              },
              users: {
                $map: {
                  input: {
                    $filter: {
                      input: "$reactionsRaw",
                      as: "r",
                      cond: { $eq: ["$$r.emoji", "$$emoji"] },
                    },
                  },
                  as: "reaction",
                  in: "$$reaction.userId",
                },
              },
            },
          },
        },
      },
    },

    // Project final fields
    {
      $project: {
        _id: 1,
        conversationId: 1,
        authorId: 1,
        author: 1,
        contentDoc: 1,
        contentText: 1,
        attachmentsUrls: 1,
        attachmentsMeta: 1,
        links: 1,
        clientMsgId: 1,
        editedAt: 1,
        deletedAt: 1,
        parentMessageId: 1,
        replyCount: 1,
        lastReplyAt: 1,
        lastReplyText: 1,
        lastReplyAuthorId: 1,
        reactions: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },

    // Sort by newest first (reverse chronological - like WhatsApp)
    {
      $sort: { createdAt: -1 },
    },
  ];
};

/**
 * Get user's DM and Group DM conversations (like WhatsApp/Slack sidebar)
 * Returns all conversations with unread counts, participant details, and chat names
 * Uses $facet to calculate totalUnreadCount in same query
 * @param {string} userId - Current user ID
 * @param {string} companyId - Company ID
 * @param {number} page - Page number for pagination
 * @param {number} limit - Items per page
 * @returns {Array} Aggregation pipeline
 */
exports.getUserConversationsQuery = (userId, companyId, page = 1, limit = 20) => {
  const userObjectId = Types.ObjectId.createFromHexString(userId);

  return [
    // Match conversations user is part of (DM and Group DM only)
    {
      $match: {
        companyId: Types.ObjectId.createFromHexString(companyId),
        type: { $in: ["dm", "group_dm"] },
        participantIds: userObjectId,
      },
    },

    // Get user's lastReadAt from participants array
    {
      $addFields: {
        userParticipant: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$participants",
                as: "p",
                cond: { $eq: ["$$p.userId", userObjectId] },
              },
            },
            0,
          ],
        },
      },
    },

    // Lookup unread messages count
    {
      $lookup: {
        from: "chatmessages",
        let: {
          convId: "$_id",
          lastRead: "$userParticipant.lastReadAt",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$conversationId", "$$convId"] },
                  { $ne: ["$authorId", userObjectId] }, // Exclude own messages
                  {
                    $cond: {
                      if: { $ne: ["$$lastRead", null] },
                      then: { $gt: ["$createdAt", "$$lastRead"] },
                      else: true, // All messages are unread if never read
                    },
                  },
                  { $eq: ["$deletedAt", null] }, // Don't count deleted messages
                ],
              },
            },
          },
          { $count: "count" },
        ],
        as: "unreadMessages",
      },
    },

    // Lookup participants details (excluding current user)
    {
      $lookup: {
        from: "users",
        let: { participantIds: "$participantIds" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$participantIds"] },
                  { $ne: ["$_id", userObjectId] }, // Filter out logged-in user
                ],
              },
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              image: 1,
              coverImage: 1,
              title: 1,
              designation: 1,
              nickname: 1,
              dob: 1,
              gender: 1,
              description: 1,
            },
          },
        ],
        as: "participants",
      },
    },

    // Add computed fields
    {
      $addFields: {
        unreadCount: {
          $ifNull: [{ $arrayElemAt: ["$unreadMessages.count", 0] }, 0],
        },
        // Compute chat name based on type
        chatName: {
          $cond: {
            if: { $eq: ["$type", "dm"] },
            then: { $arrayElemAt: ["$participants.name", 0] }, // DM: other person's name
            else: {
              // Group DM: comma-separated names
              $reduce: {
                input: "$participants",
                initialValue: "",
                in: {
                  $concat: [
                    "$$value",
                    { $cond: [{ $eq: ["$$value", ""] }, "", ", "] },
                    "$$this.name",
                  ],
                },
              },
            },
          },
        },
      },
    },

    // Project final fields
    {
      $project: {
        _id: 1,
        type: 1,
        chatName: 1,
        lastMessageAt: 1,
        lastMessageText: 1,
        unreadCount: 1,
        participants: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },

    // Use $facet to calculate both conversations and totalUnreadCount in one query
    {
      $facet: {
        // Conversations data with pagination
        conversations: [
          { $sort: { lastMessageAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        // Metadata: total unread count and total conversation count
        metadata: [
          {
            $group: {
              _id: null,
              totalUnreadCount: { $sum: "$unreadCount" },
              totalConversations: { $sum: 1 },
            },
          },
        ],
      },
    },

    // Unwind and restructure to final format
    {
      $project: {
        conversations: 1,
        totalUnreadCount: {
          $ifNull: [{ $arrayElemAt: ["$metadata.totalUnreadCount", 0] }, 0],
        },
        totalConversations: {
          $ifNull: [{ $arrayElemAt: ["$metadata.totalConversations", 0] }, 0],
        },
      },
    },
  ];
};
