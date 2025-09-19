const { Types } = require("mongoose");

/**
 * Get all channel groups of a company with populated channel information filtered by user's channel membership
 * @param {string} companyId - Company ID
 * @param {string} userId - User ID to filter by channel membership
 * @returns {Array} Aggregation pipeline
 */
exports.getAllChannelGroupsQuery = (companyId, userId) => {
  return [
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
            $project: {
              _id: 1,
              channelName: 1,
              channelDescription: 1,
              createdAt: 1,
              members: 1, // Include members for filtering
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

    // Only include groups that have at least one channel the user is a member of
    {
      $match: {
        "userChannels.0": { $exists: true }, // At least one channel exists where user is member
      },
    },

    // Clean up channels field (remove members for response)
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

    // Project final structure
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
      },
    },

    // Sort by creation date (newest first)
    {
      $sort: {
        createdAt: -1,
      },
    },
  ];
};

