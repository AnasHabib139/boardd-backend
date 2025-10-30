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

  const conversationObjectId = Types.ObjectId.isValid(conversationId)
    ? new Types.ObjectId(conversationId)
    : null;

  return [
    {
      $match: matchStage,
    },

    // Add conversation details as a field (needed for company and client lookups)
    {
      $lookup: {
        from: "chatconversations",
        let: { convId: conversationObjectId },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$convId"] }
            }
          },
          {
            $project: {
              type: 1,
              companyId: 1,
              channelId: 1,
              clientContact: 1,
              externalContacts: 1
            }
          }
        ],
        as: "conversationDetails"
      }
    },

    // Unwind conversation details
    {
      $unwind: {
        path: "$conversationDetails",
        preserveNullAndEmptyArrays: true
      }
    },

    // Lookup company details (only if conversation type is "client")
    {
      $lookup: {
        from: "companies",
        let: {
          companyId: "$conversationDetails.companyId",
          isClientConvo: { $eq: ["$conversationDetails.type", "client"] }
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$companyId"] },
                  "$$isClientConvo"
                ]
              }
            }
          },
          {
            $project: {
              "twilioConfig.fromNumbers": 1,
              "twilioConfig.whatsappSenders": 1,
              "emailConfig.sendgrid.senders": 1
            }
          }
        ],
        as: "companyDetails"
      }
    },

    // Lookup client via channel tabs (only if conversation type is "client")
    {
      $lookup: {
        from: "channeltabs",
        let: {
          channelId: "$conversationDetails.channelId",
          isClientConvo: { $eq: ["$conversationDetails.type", "client"] }
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$channelId", "$$channelId"] },
                  "$$isClientConvo"
                ]
              }
            }
          },
          { $limit: 1 },
          {
            $lookup: {
              from: "clients",
              localField: "_id",
              foreignField: "tabId",
              as: "clientData",
              pipeline: [
                {
                  $project: {
                    personalDetails: 1
                  }
                }
              ]
            }
          },
          {
            $unwind: {
              path: "$clientData",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $project: {
              personalDetails: { $ifNull: ["$clientData.personalDetails", []] }
            }
          }
        ],
        as: "clientDetails"
      }
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

    // Add computed fields for client conversations
    {
      $addFields: {
        conversationType: "$conversationDetails.type",

        // Company messaging channels (only for client conversations)
        messagingChannels: {
          $cond: {
            if: { $eq: ["$conversationDetails.type", "client"] },
            then: {
              $let: {
                vars: {
                  company: { $arrayElemAt: ["$companyDetails", 0] }
                },
                in: {
                  sms: { $ifNull: ["$$company.twilioConfig.fromNumbers", []] },
                  whatsapp: {
                    $map: {
                      input: {
                        $filter: {
                          input: { $ifNull: ["$$company.twilioConfig.whatsappSenders", []] },
                          as: "sender",
                          cond: { $eq: ["$$sender.status", "active"] }
                        }
                      },
                      as: "sender",
                      in: "$$sender.number"
                    }
                  },
                  email: {
                    $map: {
                      input: {
                        $filter: {
                          input: { $ifNull: ["$$company.emailConfig.sendgrid.senders", []] },
                          as: "sender",
                          cond: { $eq: ["$$sender.domainVerified", true] }
                        }
                      },
                      as: "sender",
                      in: "$$sender.email"
                    }
                  }
                }
              }
            },
            else: "$$REMOVE"
          }
        },

        // Client contact information (only for client conversations)
        clientContactInfo: {
          $cond: {
            if: { $eq: ["$conversationDetails.type", "client"] },
            then: {
              fromClientModel: {
                $ifNull: [
                  { $arrayElemAt: ["$clientDetails.personalDetails", 0] },
                  []
                ]
              },
              fromConversation: {
                clientContact: { $ifNull: ["$conversationDetails.clientContact", null] },
                externalContacts: { $ifNull: ["$conversationDetails.externalContacts", null] }
              }
            },
            else: "$$REMOVE"
          }
        }
      }
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
        conversationType: 1,
        messagingChannels: 1,
        clientContactInfo: 1,
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
 * NOTE: Client chat conversations are excluded from this list
 * @param {string} userId - Current user ID
 * @param {string} companyId - Company ID
 * @param {number} page - Page number for pagination
 * @param {number} limit - Items per page
 * @returns {Array} Aggregation pipeline
 */
exports.getUserConversationsQuery = (userId, companyId, page = 1, limit = 20) => {
  const userObjectId = Types.ObjectId.createFromHexString(userId);

  return [
    // Match conversations user is part of (DM and Group DM only, exclude client chat)
    {
      $match: {
        companyId: Types.ObjectId.createFromHexString(companyId),
        type: { $in: ["dm", "group_dm"] }, // Removed "client"
        "participants.userId": userObjectId,
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
          $switch: {
            branches: [
              {
                case: { $eq: ["$type", "dm"] },
                then: { $arrayElemAt: ["$participants.name", 0] }, // DM: other person's name
              },
            ],
            default: {
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
