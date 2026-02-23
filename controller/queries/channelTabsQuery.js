// write a query to get all tabs of a channel in which the user is a member
const { Types } = require("mongoose");
const { TAB_ORDER } = require("../../utils/constants");

exports.getAllTabsOfMemberInChannelQuery = (channelId, userId) => {
  return [
    {
      $match: {
        channelId: {
          $eq: Types.ObjectId.isValid(channelId)
            ? Types.ObjectId.createFromHexString(channelId)
            : null,
        },
        members: {
          $in: [
            Types.ObjectId.isValid(userId)
              ? Types.ObjectId.createFromHexString(userId)
              : null,
          ],
        },
        $or: [
          { isActive: true }, // Explicitly active tabs
          { isActive: { $exists: false } }, // Legacy tabs without isActive field
          { isActive: null }, // Tabs with null isActive
        ],
      },
    },
    {
      $lookup: {
        from: "channels",
        localField: "channelId",
        foreignField: "_id",
        as: "channelInfo",
      },
    },
    {
      $unwind: {
        path: "$channelInfo",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        // Add custom sort order based on tab name using TAB_ORDER constants
        sortOrder: {
          $switch: {
            branches: [
              ...Object.entries(TAB_ORDER)
                .filter(([tabName]) => tabName !== "embed")
                .map(([tabName, order]) => ({
                  case: { $eq: ["$tabName", tabName] },
                  then: order,
                })),
              // Embed tabs get the embed order regardless of tabName
              {
                case: { $eq: ["$tabType", "embed"] },
                then: TAB_ORDER.embed,
              },
            ],
            default: 999, // For any non-standard tabs, put them at the end
          },
        },
      },
    },
    // Lookup team chat conversation unread count
    {
      $lookup: {
        from: "chatconversations",
        let: { channelId: "$channelId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$type", "channel"] },
                  { $eq: ["$channelId", "$$channelId"] },
                ],
              },
            },
          },
          {
            $addFields: {
              userParticipant: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$participants",
                      as: "p",
                      cond: {
                        $eq: [
                          "$$p.userId",
                          Types.ObjectId.createFromHexString(userId),
                        ],
                      },
                    },
                  },
                  0,
                ],
              },
            },
          },
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
                        {
                          $cond: {
                            if: { $ne: ["$$lastRead", null] },
                            then: { $gt: ["$createdAt", "$$lastRead"] },
                            else: true,
                          },
                        },
                      ],
                    },
                  },
                },
                { $count: "count" },
              ],
              as: "unreadMessages",
            },
          },
          {
            $project: {
              _id: 1,
              unreadCount: {
                $ifNull: [
                  { $arrayElemAt: ["$unreadMessages.count", 0] },
                  0,
                ],
              },
            },
          },
        ],
        as: "teamChatConversation",
      },
    },
    // Lookup client chat conversation unread count
    {
      $lookup: {
        from: "chatconversations",
        let: { channelId: "$channelId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$type", "client"] },
                  { $eq: ["$channelId", "$$channelId"] },
                ],
              },
            },
          },
          {
            $addFields: {
              userParticipant: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: "$participants",
                      as: "p",
                      cond: {
                        $eq: [
                          "$$p.userId",
                          Types.ObjectId.createFromHexString(userId),
                        ],
                      },
                    },
                  },
                  0,
                ],
              },
            },
          },
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
                        {
                          $cond: {
                            if: { $ne: ["$$lastRead", null] },
                            then: { $gt: ["$createdAt", "$$lastRead"] },
                            else: true,
                          },
                        },
                      ],
                    },
                  },
                },
                { $count: "count" },
              ],
              as: "unreadMessages",
            },
          },
          {
            $project: {
              _id: 1,
              unreadCount: {
                $ifNull: [
                  { $arrayElemAt: ["$unreadMessages.count", 0] },
                  0,
                ],
              },
            },
          },
        ],
        as: "clientChatConversation",
      },
    },
    // Conditionally assign unreadCount and conversationId based on tabName
    {
      $addFields: {
        unreadCount: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$tabName", "team chat"] },
                then: {
                  $ifNull: [
                    { $arrayElemAt: ["$teamChatConversation.unreadCount", 0] },
                    0,
                  ],
                },
              },
              {
                case: { $eq: ["$tabName", "client chat"] },
                then: {
                  $ifNull: [
                    {
                      $arrayElemAt: [
                        "$clientChatConversation.unreadCount",
                        0,
                      ],
                    },
                    0,
                  ],
                },
              },
            ],
            default: 0,
          },
        },
        conversationId: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$tabName", "team chat"] },
                then: {
                  $arrayElemAt: ["$teamChatConversation._id", 0],
                },
              },
              {
                case: { $eq: ["$tabName", "client chat"] },
                then: {
                  $arrayElemAt: ["$clientChatConversation._id", 0],
                },
              },
            ],
            default: null,
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        tabName: 1,
        tabDescription: 1,
        channelId: 1,
        isActive: 1,
        isPrivate: 1,
        isDefault: 1,
        tabType: 1,
        embedConfig: 1,
        // members: 1,
        createdAt: 1,
        updatedAt: 1,
        channelName: "$channelInfo.channelName",
        channelDescription: "$channelInfo.channelDescription",
        sortOrder: 1, // Include sortOrder for controller sorting
        unreadCount: 1,
        conversationId: 1,
      },
    },
  ];
};

// get all members of a tab with their details (returns tab with nested members - original)
exports.getAllTabMembersQuery = (tabId) => {
  return [
    {
      $match: {
        _id: Types.ObjectId.isValid(tabId)
          ? Types.ObjectId.createFromHexString(tabId)
          : null,
        $or: [
          { isActive: true }, // Explicitly active tabs
          { isActive: { $exists: false } }, // Legacy tabs without isActive field
          { isActive: null }, // Tabs with null isActive
        ],
      },
    },
    {
      // Lookup users collection to get member details
      $lookup: {
        from: "users",
        let: { memberIds: "$members" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$memberIds"] },
                  { $eq: ["$isActive", true] },
                ],
              },
            },
          },
        ],
        as: "memberDetails",
      },
    },
    {
      // Project only the required fields
      $project: {
        _id: 1,
        tabName: 1,
        tabDescription: 1,
        isPrivate: 1,
        isDefault: 1,
        channelId: 1,
        companyId: 1,
        createdAt: 1,
        updatedAt: 1,
        members: {
          $map: {
            input: "$memberDetails",
            as: "member",
            in: {
              _id: "$$member._id",
              name: "$$member.name",
              email: "$$member.email",
              title: "$$member.title",
              designation: "$$member.designation",
              image: "$$member.image",
              coverImage: "$$member.coverImage",
              description: "$$member.description",
              dob: "$$member.dob",
              gender: "$$member.gender",
              nickname: "$$member.nickname",
              role: "$$member.role",
              isActive: "$$member.isActive",
            },
          },
        },
        totalMembers: { $size: "$memberDetails" },
      },
    },
  ];
};

// get members of a tab as individual documents for pagination
exports.getTabMembersPaginatedQuery = (tabId) => {
  return [
    {
      $match: {
        _id: Types.ObjectId.isValid(tabId)
          ? Types.ObjectId.createFromHexString(tabId)
          : null,
        $or: [
          { isActive: true }, // Explicitly active tabs
          { isActive: { $exists: false } }, // Legacy tabs without isActive field
          { isActive: null }, // Tabs with null isActive
        ],
      },
    },
    {
      // Unwind the members array to get individual member documents
      $unwind: {
        path: "$members",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      // Lookup user details for each member
      $lookup: {
        from: "users",
        let: { memberId: "$members" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$memberId"] },
                  { $eq: ["$isActive", true] },
                ],
              },
            },
          },
        ],
        as: "memberDetails",
      },
    },
    {
      // Unwind member details (should be only one user per member)
      $unwind: {
        path: "$memberDetails",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      // Project the final member structure (simplified)
      $project: {
        _id: "$memberDetails._id",
        name: "$memberDetails.name",
        email: "$memberDetails.email",
        title: "$memberDetails.title",
        designation: "$memberDetails.designation",
        image: "$memberDetails.image",
        coverImage: "$memberDetails.coverImage",
        description: "$memberDetails.description",
        dob: "$memberDetails.dob",
        gender: "$memberDetails.gender",
        nickname: "$memberDetails.nickname",
        role: "$memberDetails.role",
        isActive: "$memberDetails.isActive",
        joinedAt: "$memberDetails.createdAt",
      },
    },
    {
      // Sort by name for consistent pagination
      $sort: {
        name: 1,
        _id: 1, // Secondary sort for consistent pagination
      },
    },
  ];
};
