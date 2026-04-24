const { Types } = require("mongoose");
const { UNASSIGNED_CHANNEL_GROUP_ID, INDEFINITE_MUTE_DATE } = require("../../utils/constants");

/**
 * Get all channel groups of a company with populated channel information filtered by user's channel membership
 * Plus create a runtime "Unassigned Channels" group for channels not in any group
 * @param {string} companyId - Company ID
 * @param {string} userId - User ID to filter by channel membership
 * @returns {Array} Aggregation pipeline
 */
exports.getAllChannelGroupsQuery = (companyId, userId) => {
  return [
    {
      $facet: {
        // Get all channel groups with user's channels
        channelGroups: [
          // Match channel groups by companyId
          {
            $match: {
              companyId: Types.ObjectId.createFromHexString(companyId),
              isActive: true,
              isArchived: false,
            },
          },

          // Lookup all channels information first
          {
            $lookup: {
              from: "channels",
              localField: "channelIds",
              foreignField: "_id",
              as: "allChannels",
              pipeline: [
                {
                  $match: {
                    isArchived: { $ne: true }, // Exclude archived channels
                  },
                },
                // Lookup chat conversation for unread count
                {
                  $lookup: {
                    from: "chatconversations",
                    let: { channelId: "$_id" },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $and: [
                              { $eq: ["$type", "channel"] },
                              { $eq: ["$channelId", "$$channelId"] }
                            ]
                          }
                        }
                      },
                      // Find user's participant entry
                      {
                        $addFields: {
                          userParticipant: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: "$participants",
                                  as: "p",
                                  cond: { $eq: ["$$p.userId", Types.ObjectId.createFromHexString(userId)] }
                                }
                              },
                              0
                            ]
                          }
                        }
                      },
                      // Lookup unread messages count
                      {
                        $lookup: {
                          from: "chatmessages",
                          let: {
                            convId: "$_id",
                            lastRead: "$userParticipant.lastReadAt"
                          },
                          pipeline: [
                            {
                              $match: {
                                $expr: {
                                  $and: [
                                    { $eq: ["$conversationId", "$$convId"] },
                                    {
                                      $cond: {
                                        if: { $ne: ["$$lastRead", null] },
                                        then: { $gt: ["$createdAt", "$$lastRead"] },
                                        else: true // If never read, all messages are unread
                                      }
                                    }
                                  ]
                                }
                              }
                            },
                            { $count: "count" }
                          ],
                          as: "unreadMessages"
                        }
                      },
                      {
                        $project: {
                          _id: 1,
                          unreadCount: {
                            $ifNull: [
                              { $arrayElemAt: ["$unreadMessages.count", 0] },
                              0
                            ]
                          }
                        }
                      }
                    ],
                    as: "conversation"
                  }
                },
                // Lookup creator details for each channel
                {
                  $lookup: {
                    from: "users",
                    localField: "createdBy",
                    foreignField: "_id",
                    as: "creator",
                    pipeline: [
                      {
                        $project: {
                          _id: 1,
                          name: 1,
                          email: 1,
                          image: 1,
                          coverImage: 1,
                          role: 1,
                          designation: 1,
                          title: 1,
                        },
                      },
                    ],
                  },
                },
                {
                  $unwind: {
                    path: "$creator",
                    preserveNullAndEmptyArrays: true,
                  },
                },
                // Lookup mute info for this channel directly from DB (avoids JS/BSON serialization issues)
                {
                  $lookup: {
                    from: "usermutepreferences",
                    let: { channelId: "$_id" },
                    pipeline: [
                      {
                        $match: {
                          $expr: { $eq: ["$userId", Types.ObjectId.createFromHexString(userId)] }
                        }
                      },
                      {
                        $project: {
                          activeMute: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: "$channelMutes",
                                  as: "cm",
                                  cond: {
                                    $and: [
                                      { $eq: ["$$cm.channelId", "$$channelId"] },
                                      { $eq: [{ $type: "$$cm.muteUntil" }, "date"] },
                                      { $gt: ["$$cm.muteUntil", new Date()] }
                                    ]
                                  }
                                }
                              },
                              0
                            ]
                          }
                        }
                      }
                    ],
                    as: "muteInfo"
                  }
                },
                {
                  $project: {
                    _id: 1,
                    channelName: 1,
                    channelDescription: 1,
                    createdAt: 1,
                    members: 1, // Include members for filtering
                    creator: 1, // Include creator details
                    conversationId: {
                      $arrayElemAt: ["$conversation._id", 0]
                    },
                    unreadCount: {
                      $ifNull: [
                        { $arrayElemAt: ["$conversation.unreadCount", 0] },
                        0 // Default to 0 if no conversation exists
                      ]
                    },
                    isMuted: { $ne: [{ $arrayElemAt: ["$muteInfo.activeMute", 0] }, null] },
                    muteUntil: {
                      $let: {
                        vars: { raw: { $arrayElemAt: ["$muteInfo.activeMute.muteUntil", 0] } },
                        in: {
                          $cond: {
                            if: { $gte: ["$$raw", INDEFINITE_MUTE_DATE] },
                            then: null,
                            else: { $ifNull: ["$$raw", null] }
                          }
                        }
                      }
                    }
                  },
                },
              ],
            },
          },

          // Filter channels where user is a member
          {
            $addFields: {
              userChannels: {
                $filter: {
                  input: "$allChannels",
                  cond: {
                    $in: [Types.ObjectId.createFromHexString(userId), "$$this.members"]
                  }
                }
              }
            }
          },

          // Only include groups where user is associated (either member of channels OR created the group)
          {
            $match: {
              $or: [
                { "userChannels.0": { $exists: true } }, // User is a member of at least one channel in the group
                { "createdBy": Types.ObjectId.createFromHexString(userId) } // User created the group
              ]
            },
          },

          // Clean up channels field (remove members for response, include conversationId, unreadCount, creator, and mute info)
          {
            $addFields: {
              channels: {
                $map: {
                  input: "$userChannels",
                  as: "channel",
                  in: {
                    _id: "$$channel._id",
                    channelName: "$$channel.channelName",
                    channelDescription: "$$channel.channelDescription",
                    createdAt: "$$channel.createdAt",
                    conversationId: "$$channel.conversationId",
                    unreadCount: "$$channel.unreadCount",
                    creator: "$$channel.creator",
                    isMuted: "$$channel.isMuted",
                    muteUntil: "$$channel.muteUntil"
                  }
                }
              }
            }
          },

          // Lookup creator information
          {
            $lookup: {
              from: "users",
              localField: "createdBy",
              foreignField: "_id",
              as: "creator",
              pipeline: [
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    email: 1,
                    title: 1,
                    designation: 1,
                    image: 1,
                    coverImage: 1,
                    description: 1,
                    dob: 1,
                    gender: 1,
                    nickname: 1,
                  },
                },
              ],
            },
          },

          // Unwind creator (should be single user)
          {
            $unwind: {
              path: "$creator",
              preserveNullAndEmptyArrays: true,
            },
          },

          // Add computed fields
          {
            $addFields: {
              channelCount: { $size: "$channels" },
            },
          },

          // Add isRuntimeGroup field for real groups
          {
            $addFields: {
              isRuntimeGroup: false, // Mark as real group
            },
          },

          // Project final structure for real groups
          {
            $project: {
              _id: 1,
              title: 1,
              companyId: 1,
              isActive: 1,
              isArchived: 1,
              createdAt: 1,
              updatedAt: 1,
              creator: 1,
              channelCount: 1,
              channels: 1,
              isRuntimeGroup: 1,
            },
          },
        ],

        // Get unassigned channels (channels user is member of but not in any group)
        unassignedChannels: [
          // Start with a dummy document to use facet
          { $limit: 1 },

          // Get all channels where user is a member
          {
            $lookup: {
              from: "channels",
              pipeline: [
                {
                  $match: {
                    companyId: Types.ObjectId.createFromHexString(companyId),
                    members: Types.ObjectId.createFromHexString(userId),
                    isArchived: { $ne: true }, // Exclude archived channels
                  },
                },
                // Lookup chat conversation for unread count (same as above)
                {
                  $lookup: {
                    from: "chatconversations",
                    let: { channelId: "$_id" },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $and: [
                              { $eq: ["$type", "channel"] },
                              { $eq: ["$channelId", "$$channelId"] }
                            ]
                          }
                        }
                      },
                      // Find user's participant entry
                      {
                        $addFields: {
                          userParticipant: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: "$participants",
                                  as: "p",
                                  cond: { $eq: ["$$p.userId", Types.ObjectId.createFromHexString(userId)] }
                                }
                              },
                              0
                            ]
                          }
                        }
                      },
                      // Lookup unread messages count
                      {
                        $lookup: {
                          from: "chatmessages",
                          let: {
                            convId: "$_id",
                            lastRead: "$userParticipant.lastReadAt"
                          },
                          pipeline: [
                            {
                              $match: {
                                $expr: {
                                  $and: [
                                    { $eq: ["$conversationId", "$$convId"] },
                                    {
                                      $cond: {
                                        if: { $ne: ["$$lastRead", null] },
                                        then: { $gt: ["$createdAt", "$$lastRead"] },
                                        else: true // If never read, all messages are unread
                                      }
                                    }
                                  ]
                                }
                              }
                            },
                            { $count: "count" }
                          ],
                          as: "unreadMessages"
                        }
                      },
                      {
                        $project: {
                          _id: 1,
                          unreadCount: {
                            $ifNull: [
                              { $arrayElemAt: ["$unreadMessages.count", 0] },
                              0
                            ]
                          }
                        }
                      }
                    ],
                    as: "conversation"
                  }
                },
                // Lookup creator details for each channel
                {
                  $lookup: {
                    from: "users",
                    localField: "createdBy",
                    foreignField: "_id",
                    as: "creator",
                    pipeline: [
                      {
                        $project: {
                          _id: 1,
                          name: 1,
                          email: 1,
                          image: 1,
                          coverImage: 1,
                          role: 1,
                          designation: 1,
                          title: 1,
                        },
                      },
                    ],
                  },
                },
                {
                  $unwind: {
                    path: "$creator",
                    preserveNullAndEmptyArrays: true,
                  },
                },
                // Lookup mute info for this channel directly from DB
                {
                  $lookup: {
                    from: "usermutepreferences",
                    let: { channelId: "$_id" },
                    pipeline: [
                      {
                        $match: {
                          $expr: { $eq: ["$userId", Types.ObjectId.createFromHexString(userId)] }
                        }
                      },
                      {
                        $project: {
                          activeMute: {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: "$channelMutes",
                                  as: "cm",
                                  cond: {
                                    $and: [
                                      { $eq: ["$$cm.channelId", "$$channelId"] },
                                      { $eq: [{ $type: "$$cm.muteUntil" }, "date"] },
                                      { $gt: ["$$cm.muteUntil", new Date()] }
                                    ]
                                  }
                                }
                              },
                              0
                            ]
                          }
                        }
                      }
                    ],
                    as: "muteInfo"
                  }
                },
                {
                  $project: {
                    _id: 1,
                    channelName: 1,
                    channelDescription: 1,
                    createdAt: 1,
                    creator: 1, // Include creator details
                    conversationId: {
                      $arrayElemAt: ["$conversation._id", 0]
                    },
                    unreadCount: {
                      $ifNull: [
                        { $arrayElemAt: ["$conversation.unreadCount", 0] },
                        0 // Default to 0 if no conversation exists
                      ]
                    },
                    isMuted: { $ne: [{ $arrayElemAt: ["$muteInfo.activeMute", 0] }, null] },
                    muteUntil: {
                      $let: {
                        vars: { raw: { $arrayElemAt: ["$muteInfo.activeMute.muteUntil", 0] } },
                        in: {
                          $cond: {
                            if: { $gte: ["$$raw", INDEFINITE_MUTE_DATE] },
                            then: null,
                            else: { $ifNull: ["$$raw", null] }
                          }
                        }
                      }
                    }
                  },
                },
              ],
              as: "userChannels",
            },
          },

          // Get all channels that are assigned to groups
          {
            $lookup: {
              from: "channelgroups",
              pipeline: [
                {
                  $match: {
                    companyId: Types.ObjectId.createFromHexString(companyId),
                    isActive: true,
                    isArchived: false,
                  },
                },
                {
                  $unwind: "$channelIds",
                },
                {
                  $group: {
                    _id: null,
                    assignedChannelIds: { $addToSet: "$channelIds" },
                  },
                },
              ],
              as: "assignedChannels",
            },
          },

          // Filter out channels that are already in groups
          {
            $addFields: {
              assignedChannelIds: {
                $ifNull: [
                  { $arrayElemAt: ["$assignedChannels.assignedChannelIds", 0] },
                  []
                ]
              },
              unassignedChannels: {
                $filter: {
                  input: "$userChannels",
                  cond: {
                    $not: {
                      $in: ["$$this._id", {
                        $ifNull: [
                          { $arrayElemAt: ["$assignedChannels.assignedChannelIds", 0] },
                          []
                        ]
                      }]
                    }
                  }
                }
              }
            }
          },

          // Project the unassigned channels
          {
            $project: {
              unassignedChannels: 1,
            },
          },
        ],
      },
    },

    // Combine the results
    {
      $addFields: {
        // Create runtime "Unassigned Channels" group if there are unassigned channels
        unassignedGroup: {
          $let: {
            vars: {
              unassignedChannels: { $arrayElemAt: ["$unassignedChannels.unassignedChannels", 0] }
            },
            in: {
              $cond: {
                if: { $gt: [{ $size: { $ifNull: ["$$unassignedChannels", []] } }, 0] },
                then: {
                  _id: Types.ObjectId.createFromHexString(UNASSIGNED_CHANNEL_GROUP_ID),
                  title: "Unassigned Channels",
                  companyId: Types.ObjectId.createFromHexString(companyId),
                  isActive: true,
                  isArchived: false,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  creator: null,
                  channelCount: { $size: { $ifNull: ["$$unassignedChannels", []] } },
                  channels: {
                    $map: {
                      input: { $ifNull: ["$$unassignedChannels", []] },
                      as: "uch",
                      in: {
                        _id: "$$uch._id",
                        channelName: "$$uch.channelName",
                        channelDescription: "$$uch.channelDescription",
                        createdAt: "$$uch.createdAt",
                        conversationId: "$$uch.conversationId",
                        unreadCount: "$$uch.unreadCount",
                        creator: "$$uch.creator",
                        isMuted: "$$uch.isMuted",
                        muteUntil: "$$uch.muteUntil"
                      }
                    }
                  },
                  isRuntimeGroup: true, // Mark as runtime group
                },
                else: null
              }
            }
          }
        }
      }
    },

    // Combine all groups
    {
      $addFields: {
        allGroups: {
          $concatArrays: [
            "$channelGroups",
            {
              $cond: {
                if: { $ne: ["$unassignedGroup", null] },
                then: ["$unassignedGroup"],
                else: []
              }
            }
          ]
        }
      }
    },

    // Unwind to get individual groups
    {
      $unwind: "$allGroups"
    },

    // Replace root with group data
    {
      $replaceRoot: {
        newRoot: "$allGroups"
      }
    },

    // Sort by type (real groups first, then unassigned) and creation date
    {
      $sort: {
        isRuntimeGroup: 1, // Real groups first (false = 0, true = 1)
        createdAt: -1,
      },
    },
  ];
};

