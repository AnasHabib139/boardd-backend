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
                  "$$isClientConvo",
                  { $eq: ["$tabName", "client management"] }
                ]
              }
            }
          },
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

    // Format author name for inbound messages to show contact info + channel
    {
      $addFields: {
        author: {
          $cond: {
            if: {
              $and: [
                { $eq: ["$direction", "inbound"] },
                { $ne: ["$senderContactInfo", null] },
                { $ne: ["$senderChannel", null] }
              ]
            },
            then: {
              _id: null,
              name: {
                $concat: [
                  "$senderContactInfo",
                  " (",
                  { $toUpper: "$senderChannel" },
                  ")"
                ]
              },
              email: {
                $cond: {
                  if: { $eq: ["$senderChannel", "email"] },
                  then: "$senderContactInfo",
                  else: null
                }
              },
              image: null
            },
            else: "$author"
          }
        }
      }
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

        // DEBUG: Show what clientDetails contains
        DEBUG_clientDetails: "$clientDetails",

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
        // Merges data from both client model and conversation.clientContact
        clientContactInfo: {
          $cond: {
            if: { $eq: ["$conversationDetails.type", "client"] },
            then: {
              $let: {
                vars: {
                  clientPersonalDetails: {
                    $let: {
                      vars: {
                        firstClient: { $arrayElemAt: ["$clientDetails", 0] }
                      },
                      in: { $ifNull: ["$$firstClient.personalDetails", []] }
                    }
                  },
                  conversationContact: { $ifNull: ["$conversationDetails.clientContact", {}] }
                },
                in: {
                  // SMS numbers - merge from client model and conversation.clientContact.phoneE164
                  smsNumbers: {
                    $reduce: {
                      input: {
                        $concatArrays: [
                          // From client model
                          {
                            $map: {
                              input: {
                                $filter: {
                                  input: "$$clientPersonalDetails",
                                  as: "detail",
                                  cond: {
                                    $and: [
                                      { $ne: ["$$detail.phone", null] },
                                      { $ne: ["$$detail.phone.number", null] }
                                    ]
                                  }
                                }
                              },
                              as: "detail",
                              in: {
                                number: {
                                  $concat: [
                                    { $toString: { $ifNull: ["$$detail.phone.countryCode", ""] } },
                                    { $toString: { $ifNull: ["$$detail.phone.number", ""] } }
                                  ]
                                },
                                name: { $ifNull: ["$$detail.name", ""] },
                                source: "clientModel"
                              }
                            }
                          },
                          // From conversation.clientContact
                          {
                            $cond: {
                              if: { $ne: ["$$conversationContact.phoneE164", null] },
                              then: [{
                                number: "$$conversationContact.phoneE164",
                                name: { $ifNull: ["$$conversationContact.name", ""] },
                                source: "conversationContact"
                              }],
                              else: []
                            }
                          }
                        ]
                      },
                      initialValue: [],
                      in: {
                        $cond: {
                          if: {
                            $in: ["$$this.number", "$$value.number"]
                          },
                          then: "$$value",
                          else: { $concatArrays: ["$$value", ["$$this"]] }
                        }
                      }
                    }
                  },
                  // WhatsApp numbers - from conversation.clientContact.whatsappE164
                  whatsappNumbers: {
                    $cond: {
                      if: { $ne: ["$$conversationContact.whatsappE164", null] },
                      then: [{
                        number: "$$conversationContact.whatsappE164",
                        name: { $ifNull: ["$$conversationContact.name", ""] },
                        source: "conversationContact"
                      }],
                      else: []
                    }
                  },
                  // Emails - merge from client model and conversation.clientContact.email
                  emails: {
                    $reduce: {
                      input: {
                        $concatArrays: [
                          // From client model
                          {
                            $map: {
                              input: {
                                $filter: {
                                  input: "$$clientPersonalDetails",
                                  as: "detail",
                                  cond: { $ne: ["$$detail.email", null] }
                                }
                              },
                              as: "detail",
                              in: {
                                email: { $ifNull: ["$$detail.email", ""] },
                                name: { $ifNull: ["$$detail.name", ""] },
                                source: "clientModel"
                              }
                            }
                          },
                          // From conversation.clientContact
                          {
                            $cond: {
                              if: { $ne: ["$$conversationContact.email", null] },
                              then: [{
                                email: { $toLower: "$$conversationContact.email" },
                                name: { $ifNull: ["$$conversationContact.name", ""] },
                                source: "conversationContact"
                              }],
                              else: []
                            }
                          }
                        ]
                      },
                      initialValue: [],
                      in: {
                        $cond: {
                          if: {
                            $in: [{ $toLower: "$$this.email" }, { $map: { input: "$$value", as: "v", in: { $toLower: "$$v.email" } } }]
                          },
                          then: "$$value",
                          else: { $concatArrays: ["$$value", ["$$this"]] }
                        }
                      }
                    }
                  }
                }
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
        DEBUG_clientDetails: 1,
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

/**
 * Get conversation with chatName field
 * Adds chatName for dm and group_dm conversation types
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - Current user ID (to exclude from participant names)
 * @returns {Array} Aggregation pipeline
 */
exports.getConversationWithChatName = (conversationId, userId) => {
  const userObjectId = Types.ObjectId.createFromHexString(userId);
  const conversationObjectId = Types.ObjectId.createFromHexString(conversationId);

  return [
    // Match the specific conversation
    {
      $match: {
        _id: conversationObjectId,
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
            },
          },
        ],
        as: "participantsDetails",
      },
    },

    // Add computed chatName field
    {
      $addFields: {
        chatName: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$type", "dm"] },
                then: { $arrayElemAt: ["$participantsDetails.name", 0] }, // DM: other person's name
              },
              {
                case: { $eq: ["$type", "group_dm"] },
                then: {
                  // Group DM: comma-separated names
                  $reduce: {
                    input: "$participantsDetails",
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
            ],
            default: null, // No chatName for channel/client types
          },
        },
      },
    },

    // Remove the temporary participantsDetails field
    {
      $project: {
        participantsDetails: 0,
      },
    },
  ];
};

/**
 * Get client contact info for a client conversation when no messages exist
 * Fetches client details from "client management" tab, company messaging channels, and conversation.clientContact
 * @param {string} channelId - Channel ID
 * @param {string} companyId - Company ID
 * @param {string} conversationId - Conversation ID
 * @returns {Array} Aggregation pipeline
 */
exports.getClientContactInfoQuery = (channelId, companyId, conversationId) => {
  return [
    // Match the specific channel's "client management" tab
    {
      $match: {
        channelId: Types.ObjectId.createFromHexString(channelId),
        tabName: "client management"
      }
    },

    // Lookup conversation for clientContact
    {
      $lookup: {
        from: "chatconversations",
        let: { conversationId: Types.ObjectId.createFromHexString(conversationId) },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$conversationId"] }
            }
          },
          {
            $project: {
              clientContact: 1
            }
          }
        ],
        as: "conversationDetails"
      }
    },

    // Lookup company details for messaging channels
    {
      $lookup: {
        from: "companies",
        let: { companyId: Types.ObjectId.createFromHexString(companyId) },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$companyId"] }
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

    // Lookup client data
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

    // Unwind client data
    {
      $unwind: {
        path: "$clientData",
        preserveNullAndEmptyArrays: true
      }
    },

    // Transform personalDetails, conversation contact, and company config to response format
    {
      $project: {
        messagingChannels: {
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
        clientContactInfo: {
          $let: {
            vars: {
              clientPersonalDetails: { $ifNull: ["$clientData.personalDetails", []] },
              conversationContact: {
                $let: {
                  vars: {
                    firstConvo: { $arrayElemAt: ["$conversationDetails", 0] }
                  },
                  in: { $ifNull: ["$$firstConvo.clientContact", {}] }
                }
              }
            },
            in: {
              // SMS numbers - merge from client model and conversation.clientContact.phoneE164
              smsNumbers: {
                $reduce: {
                  input: {
                    $concatArrays: [
                      // From client model
                      {
                        $map: {
                          input: {
                            $filter: {
                              input: "$$clientPersonalDetails",
                              as: "detail",
                              cond: {
                                $and: [
                                  { $ne: ["$$detail.phone", null] },
                                  { $ne: ["$$detail.phone.number", null] }
                                ]
                              }
                            }
                          },
                          as: "detail",
                          in: {
                            number: {
                              $concat: [
                                { $toString: { $ifNull: ["$$detail.phone.countryCode", ""] } },
                                { $toString: { $ifNull: ["$$detail.phone.number", ""] } }
                              ]
                            },
                            name: { $ifNull: ["$$detail.name", ""] },
                            source: "clientModel"
                          }
                        }
                      },
                      // From conversation.clientContact
                      {
                        $cond: {
                          if: { $ne: ["$$conversationContact.phoneE164", null] },
                          then: [{
                            number: "$$conversationContact.phoneE164",
                            name: { $ifNull: ["$$conversationContact.name", ""] },
                            source: "conversationContact"
                          }],
                          else: []
                        }
                      }
                    ]
                  },
                  initialValue: [],
                  in: {
                    $cond: {
                      if: {
                        $in: ["$$this.number", "$$value.number"]
                      },
                      then: "$$value",
                      else: { $concatArrays: ["$$value", ["$$this"]] }
                    }
                  }
                }
              },
              // WhatsApp numbers - from conversation.clientContact.whatsappE164
              whatsappNumbers: {
                $cond: {
                  if: { $ne: ["$$conversationContact.whatsappE164", null] },
                  then: [{
                    number: "$$conversationContact.whatsappE164",
                    name: { $ifNull: ["$$conversationContact.name", ""] },
                    source: "conversationContact"
                  }],
                  else: []
                }
              },
              // Emails - merge from client model and conversation.clientContact.email
              emails: {
                $reduce: {
                  input: {
                    $concatArrays: [
                      // From client model
                      {
                        $map: {
                          input: {
                            $filter: {
                              input: "$$clientPersonalDetails",
                              as: "detail",
                              cond: { $ne: ["$$detail.email", null] }
                            }
                          },
                          as: "detail",
                          in: {
                            email: { $ifNull: ["$$detail.email", ""] },
                            name: { $ifNull: ["$$detail.name", ""] },
                            source: "clientModel"
                          }
                        }
                      },
                      // From conversation.clientContact
                      {
                        $cond: {
                          if: { $ne: ["$$conversationContact.email", null] },
                          then: [{
                            email: { $toLower: "$$conversationContact.email" },
                            name: { $ifNull: ["$$conversationContact.name", ""] },
                            source: "conversationContact"
                          }],
                          else: []
                        }
                      }
                    ]
                  },
                  initialValue: [],
                  in: {
                    $cond: {
                      if: {
                        $in: [{ $toLower: "$$this.email" }, { $map: { input: "$$value", as: "v", in: { $toLower: "$$v.email" } } }]
                      },
                      then: "$$value",
                      else: { $concatArrays: ["$$value", ["$$this"]] }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    // Limit to 1 result
    {
      $limit: 1
    }
  ];
};

