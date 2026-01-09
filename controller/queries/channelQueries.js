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
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
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
      $lookup: {
        from: "chatconversations",
        let: { channelId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$channelId", "$$channelId"] },
                  { $eq: ["$type", "channel"] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 1,
            },
          },
        ],
        as: "conversationDetails",
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
      $unwind: {
        path: "$conversationDetails",
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
        conversationId: "$conversationDetails._id",
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
              title: "$$member.title",
              designation: "$$member.designation",
              image: "$$member.image",
              coverImage: "$$member.coverImage",
              description: "$$member.description",
              dob: "$$member.dob",
              gender: "$$member.gender",
              nickname: "$$member.nickname",
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
          title: "$creatorDetails.title",
          designation: "$creatorDetails.designation",
          image: "$creatorDetails.image",
          coverImage: "$creatorDetails.coverImage",
          description: "$creatorDetails.description",
          dob: "$creatorDetails.dob",
          gender: "$creatorDetails.gender",
          nickname: "$creatorDetails.nickname",
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
        let: { channelMembers: "$members", currentChannelId: "$_id" },
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
            // Lookup private tabs where this user is a member
            $lookup: {
              from: "channeltabs",
              let: { userId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$channelId", "$$currentChannelId"] },
                        { $eq: ["$isPrivate", true] },
                        { $eq: ["$isActive", true] },
                        { $in: ["$$userId", "$members"] },
                      ],
                    },
                  },
                },
              ],
              as: "privateTabs",
            },
          },
          {
            // Add isPrivate field based on private tab membership
            $addFields: {
              isPrivate: {
                $cond: {
                  if: { $gt: [{ $size: "$privateTabs" }, 0] },
                  then: true,
                  else: false,
                },
              },
            },
          },
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
              role: 1,
              isActive: 1,
              isDemo: 1,
              isPrivate: 1,
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
        isDemo: "$memberDetails.isDemo",
        isPrivate: "$memberDetails.isPrivate",
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
        "creator.title": 1,
        "creator.designation": 1,
        "creator.image": 1,
        "creator.coverImage": 1,
        "creator.description": 1,
        "creator.dob": 1,
        "creator.gender": 1,
        "creator.nickname": 1,
      },
    },
    {
      $sort: { updatedAt: -1 },
    },
  ];
};

/**
 * Get channel files with type filtering
 * Merges files from both channel.files and task.attachments
 * @param {string} channelId - Channel ID
 * @param {string} type - File type filter (all, photos&images, videos, etc.)
 * @returns {Array} Aggregation pipeline
 */
exports.getChannelFilesQuery = (channelId, type) => {
  const { getMimeTypeFilter } = require("../helpers/channels/fileTypeMapper");

  // Get MIME type filters for both channel files and task attachments
  const channelFilesFilter = getMimeTypeFilter(type, "files.mimeType");
  const taskAttachmentsFilter = getMimeTypeFilter(type, "attachments.mimeType");

  const pipeline = [
    // Match the specific channel
    {
      $match: {
        _id: Types.ObjectId.createFromHexString(channelId),
      },
    },

    // Use $facet to create two parallel data streams
    {
      $facet: {
        // Stream 1: Channel files
        channelFiles: [
          // Unwind files array
          {
            $unwind: {
              path: "$files",
              preserveNullAndEmptyArrays: false,
            },
          },
          // Apply MIME type filter if specified
          ...(channelFilesFilter ? [{
            $match: channelFilesFilter
          }] : []),
          // Lookup uploader user details
          {
            $lookup: {
              from: "users",
              localField: "files.uploadedBy",
              foreignField: "_id",
              as: "uploadedByUser",
              pipeline: [
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    email: 1,
                    image: 1,
                    title: 1,
                    designation: 1,
                  },
                },
              ],
            },
          },
          {
            $unwind: {
              path: "$uploadedByUser",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Project to standard format
          {
            $project: {
              _id: "$files._id",
              url: "$files.url",
              fileName: "$files.fileName",
              fileSize: "$files.fileSize",
              mimeType: "$files.mimeType",
              uploadedBy: "$uploadedByUser",
              uploadedAt: "$files.uploadedAt",
              channelId: "$_id",
              channelName: "$channelName",
              source: { $literal: "channel" },
              taskInfo: { $literal: null },
            },
          },
        ],

        // Stream 2: Task attachments
        taskAttachments: [
          // Store channel info for later use
          {
            $addFields: {
              channelInfo: {
                _id: "$_id",
                channelName: "$channelName",
              },
            },
          },
          // Lookup tasks associated with this channel (both direct and via project)
          {
            $lookup: {
              from: "tasks",
              let: { channelId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$channelId", "$$channelId"] },
                        { $eq: ["$isActive", true] },
                        { $gt: [{ $size: { $ifNull: ["$attachments", []] } }, 0] },
                      ],
                    },
                  },
                },
                // Unwind attachments array
                {
                  $unwind: {
                    path: "$attachments",
                    preserveNullAndEmptyArrays: false,
                  },
                },
                // Filter out incomplete attachments (must have url field)
                {
                  $match: {
                    "attachments.url": { $exists: true, $ne: null, $ne: "" }
                  }
                },
                // Apply MIME type filter if specified
                ...(taskAttachmentsFilter ? [{
                  $match: taskAttachmentsFilter
                }] : []),
                // Lookup project details for task context
                {
                  $lookup: {
                    from: "projects",
                    localField: "projectId",
                    foreignField: "_id",
                    as: "project",
                  },
                },
                {
                  $unwind: {
                    path: "$project",
                    preserveNullAndEmptyArrays: true,
                  },
                },
                // Lookup uploader user details
                {
                  $lookup: {
                    from: "users",
                    localField: "attachments.uploadedBy",
                    foreignField: "_id",
                    as: "uploadedByUser",
                    pipeline: [
                      {
                        $project: {
                          _id: 1,
                          name: 1,
                          email: 1,
                          image: 1,
                          title: 1,
                          designation: 1,
                        },
                      },
                    ],
                  },
                },
                {
                  $unwind: {
                    path: "$uploadedByUser",
                    preserveNullAndEmptyArrays: true,
                  },
                },
                // Project to standard format
                {
                  $project: {
                    _id: "$attachments._id",
                    url: "$attachments.url",
                    fileName: "$attachments.fileName",
                    fileSize: "$attachments.fileSize",
                    mimeType: "$attachments.mimeType",
                    uploadedBy: "$uploadedByUser",
                    uploadedAt: "$attachments.uploadedAt",
                    taskInfo: {
                      taskId: "$_id",
                      taskTitle: "$title",
                      projectName: { $ifNull: ["$project.name", "Open"] },
                    },
                  },
                },
              ],
              as: "taskFiles",
            },
          },
          // Unwind task files
          {
            $unwind: {
              path: "$taskFiles",
              preserveNullAndEmptyArrays: false,
            },
          },
          // Add channel info to each task file
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: [
                  "$taskFiles",
                  {
                    channelId: "$channelInfo._id",
                    channelName: "$channelInfo.channelName",
                    source: "task",
                  },
                ],
              },
            },
          },
        ],
      },
    },

    // Merge both arrays
    {
      $project: {
        allFiles: {
          $concatArrays: ["$channelFiles", "$taskAttachments"],
        },
      },
    },

    // Unwind merged array
    {
      $unwind: {
        path: "$allFiles",
        preserveNullAndEmptyArrays: false,
      },
    },

    // Replace root with file object
    {
      $replaceRoot: {
        newRoot: "$allFiles",
      },
    },

    // Sort by upload date (newest first)
    {
      $sort: { uploadedAt: -1 },
    },
  ];

  return pipeline;
};
