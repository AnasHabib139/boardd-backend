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
        // Add custom sort order based on tab name
        sortOrder: {
          $switch: {
            branches: [
              { case: { $eq: ["$tabName", "team management"] }, then: 1 },
              { case: { $eq: ["$tabName", "client management"] }, then: 2 },
              { case: { $eq: ["$tabName", "form builder"] }, then: 3 },
              { case: { $eq: ["$tabName", "work in progress"] }, then: 4 },
            ],
            default: 999 // For any non-standard tabs, put them at the end
          }
        }
      }
    },
    {
      $project: {
        _id: 1,
        tabName: 1,
        tabDescription: 1,
        channelId: 1,
        // members: 1,
        createdAt: 1,
        updatedAt: 1,
        channelName: "$channelInfo.channelName",
        channelDescription: "$channelInfo.channelDescription",
        sortOrder: 1, // Include sortOrder for controller sorting
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
