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
