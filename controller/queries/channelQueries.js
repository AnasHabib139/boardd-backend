// write a query to get all members populated with their name email and id of that channel
const { Types } = require("mongoose");

// get all channels of a user
exports.getAllChannelsOfUserQuery = (userId) => {
  return [
    {
      $match: {
        members: { $in: [Types.ObjectId.createFromHexString(userId)] },
      },
    },
    {
      $lookup: {
        from: "users",
        let: { channelMembers: "$members" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $in: ["$_id", "$$channelMembers"] }, // Regular channel members
                  { $eq: ["$isDemo", true] }, // Always include demo users
                ],
              },
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              isDemo: 1,
              createdAt: 1, // Add createdAt for recent user logic
            },
          },
          {
            $sort: {
              createdAt: -1, // Sort by most recent first
              isDemo: 1, // Then demo users
            },
          },
          {
            $limit: 3, // Get 3 most recent users
          },
        ],
        as: "recentMembers",
      },
    },
    {
      $lookup: {
        from: "users",
        let: { channelMembers: "$members" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $in: ["$_id", "$$channelMembers"] }, // Regular channel members
                  { $eq: ["$isDemo", true] }, // Always include demo users
                ],
              },
            },
          },
          {
            $count: "total", // Just count all members
          },
        ],
        as: "memberCount",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creatorDetails",
      },
    },
    {
      $lookup: {
        from: "companies",
        localField: "companyId",
        foreignField: "_id",
        as: "companyDetails",
      },
    },
    {
      $unwind: {
        path: "$creatorDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$companyDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        totalMembers: {
          $cond: {
            if: { $gt: [{ $size: "$memberCount" }, 0] },
            then: { $arrayElemAt: ["$memberCount.total", 0] },
            else: 0,
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        channelName: 1,
        channelDescription: 1,
        isPrivate: 1,
        channelToken: 1,
        createdAt: 1,
        updatedAt: 1,
        totalMembers: 1,
        // Return up to 3 recent members
        recentMembers: {
          $map: {
            input: "$recentMembers",
            as: "member",
            in: {
              _id: "$$member._id",
              name: "$$member.name",
              email: "$$member.email",
              isDemo: "$$member.isDemo",
            },
          },
        },
        // Calculate remaining members count for "+X more" display
        remainingMembers: {
          $cond: {
            if: { $gt: ["$totalMembers", { $size: "$recentMembers" }] },
            then: { $subtract: ["$totalMembers", { $size: "$recentMembers" }] },
            else: 0,
          },
        },
        creator: {
          _id: "$creatorDetails._id",
          name: "$creatorDetails.name",
          email: "$creatorDetails.email",
        },
        company: {
          _id: "$companyDetails._id",
          name: "$companyDetails.name",
        },
      },
    },
    {
      $sort: { createdAt: -1 },
    },
  ];
};

// get all members in a channel
exports.getAllMembersInChannelQuery = (channelId, currentUserId) => {
  return [
    {
      $match: {
        _id: { $eq: Types.ObjectId.createFromHexString(channelId) },
      },
    },
    {
      // Lookup users collection to get member details + demo users
      $lookup: {
        from: "users",
        let: { channelMembers: "$members" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $in: ["$_id", "$$channelMembers"] }, // Regular channel members
                  { $eq: ["$isDemo", true] }, // Always include demo users
                ],
              },
            },
          },
          {
            // Exclude current logged-in user but keep demo users
            $match: {
              $or: [
                {
                  _id: {
                    $ne: Types.ObjectId.createFromHexString(currentUserId),
                  },
                },
                { isDemo: true },
              ],
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              role: 1,
              isActive: 1,
              isDemo: 1,
            },
          },
        ],
        as: "memberDetails",
      },
    },
    {
      // Unwind the memberDetails array to create individual member documents
      $unwind: {
        path: "$memberDetails",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      // Add channel info to each member document and project final structure
      $project: {
        _id: "$memberDetails._id",
        name: "$memberDetails.name",
        email: "$memberDetails.email",
        role: "$memberDetails.role",
        isActive: "$memberDetails.isActive",
        isDemo: "$memberDetails.isDemo",
        channelInfo: {
          channelId: "$_id",
          channelName: "$channelName",
          channelDescription: "$channelDescription",
          isPrivate: "$isPrivate",
        },
      },
    },
    {
      // Sort members: demo users last, then by name
      $sort: {
        isDemo: 1, // Demo users appear last
        name: 1, // Then sort by name
      },
    },
  ];
};

// get archived channels for a user
exports.getArchivedChannelsQuery = (userId) => {
  return [
    {
      $match: {
        members: Types.ObjectId.createFromHexString(userId),
        isArchived: true,
      },
    },
    {
      $lookup: {
        from: "companies",
        localField: "companyId",
        foreignField: "_id",
        as: "company",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    {
      $addFields: {
        company: { $arrayElemAt: ["$company", 0] },
        creator: { $arrayElemAt: ["$creator", 0] },
        memberCount: { $size: "$members" },
      },
    },
    {
      $project: {
        _id: 1,
        channelName: 1,
        channelDescription: 1,
        isPrivate: 1,
        isArchived: 1,
        channelToken: 1,
        memberCount: 1,
        createdAt: 1,
        updatedAt: 1,
        "company.name": 1,
        "company._id": 1,
        "creator.name": 1,
        "creator.email": 1,
        "creator._id": 1,
      },
    },
    {
      $sort: { updatedAt: -1 },
    },
  ];
};
