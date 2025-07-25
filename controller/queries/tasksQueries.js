const { Types } = require("mongoose");

exports.getTaskByIdQuery = (taskId, userId = null) => {
  return [
    {
      // Match the specific task
      $match: {
        _id: Types.ObjectId.isValid(taskId) ? new Types.ObjectId(taskId) : null,
      },
    },
    // Lookup project details
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
    // Lookup tab details
    {
      $lookup: {
        from: "channeltabs",
        localField: "project.tabId",
        foreignField: "_id",
        as: "tab",
      },
    },
    {
      $unwind: {
        path: "$tab",
        preserveNullAndEmptyArrays: true,
      },
    },
    // Lookup channel details
    {
      $lookup: {
        from: "channels",
        localField: "tab.channelId",
        foreignField: "_id",
        as: "channel",
      },
    },
    {
      $unwind: {
        path: "$channel",
        preserveNullAndEmptyArrays: true,
      },
    },
    // Lookup creator details
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    // Lookup assigned users details
    {
      $lookup: {
        from: "users",
        localField: "assignedTo",
        foreignField: "_id",
        as: "assignees",
      },
    },
    // Lookup current user details (if provided)
    ...(userId
      ? [
          {
            $lookup: {
              from: "users",
              pipeline: [
                {
                  $match: {
                    _id: Types.ObjectId.createFromHexString(userId),
                  },
                },
              ],
              as: "currentUser",
            },
          },
        ]
      : []),
    // Lookup subtasks
    {
      $lookup: {
        from: "subtasks",
        let: { taskId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$taskId", "$$taskId"] },
            },
          },
          // Lookup subtask assignee details
          {
            $lookup: {
              from: "users",
              localField: "assignedTo",
              foreignField: "_id",
              as: "assignees",
            },
          },
          // Project only needed subtask fields with proper assignee array
          {
            $project: {
              _id: 1,
              title: 1,
              isActive: 1,
              createdAt: 1,
              updatedAt: 1,
              assignees: {
                $map: {
                  input: "$assignees",
                  as: "assignee",
                  in: {
                    _id: "$$assignee._id",
                    name: "$$assignee.name",
                    email: "$$assignee.email",
                    role: "$$assignee.role",
                  },
                },
              },
            },
          },
        ],
        as: "subtasks",
      },
    },
    // Lookup activities
    {
      $lookup: {
        from: "activities",
        let: { taskId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$taskId", "$$taskId"] },
            },
          },
          // Lookup user details for each activity
          {
            $lookup: {
              from: "users",
              localField: "userId",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: {
              path: "$user",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Project activity fields including user details
          {
            $project: {
              _id: 1,
              message: 1,
              timestamp: 1,
              actionType: 1,
              field: 1,
              previousValue: 1,
              newValue: 1,
              userId: 1,
              user: {
                _id: "$user._id",
                name: "$user.name",
                email: "$user.email",
                role: "$user.role",
              },
            },
          },
          { $sort: { timestamp: -1 } },
        ],
        as: "activities",
      },
    },
    // Unwind creator array (will always be single item)
    {
      $unwind: {
        path: "$creator",
        preserveNullAndEmptyArrays: true,
      },
    },
    // Add permission calculation and user role info
    {
      $addFields: {
        permissions: {
          $cond: {
            if: { $eq: [userId, null] }, // No user provided (guest access)
            then: {
              canView: true,
              canEdit: false,
              canComment: false,
              canShare: false,
              accessLevel: "guest",
              userRole: null,
            },
            else: {
              $let: {
                vars: {
                  userObjectId: { $toObjectId: userId },
                  currentUserInfo: { $arrayElemAt: ["$currentUser", 0] },
                  isChannelMember: {
                    $in: [{ $toObjectId: userId }, "$channel.members"],
                  },
                  isTabMember: {
                    $in: [{ $toObjectId: userId }, "$tab.members"],
                  },
                  isAssigned: {
                    $in: [{ $toObjectId: userId }, "$assignedTo"],
                  },
                  isCreator: {
                    $eq: [{ $toObjectId: userId }, "$createdBy"],
                  },
                },
                in: {
                  canView: true,
                  canEdit: {
                    $or: [
                      "$$isChannelMember",
                      "$$isTabMember",
                      "$$isAssigned",
                      "$$isCreator",
                    ],
                  },
                  canComment: {
                    $or: ["$$isChannelMember", "$$isTabMember", "$$isAssigned"],
                  },
                  canShare: {
                    $or: [
                      "$$isChannelMember",
                      "$$isTabMember",
                      "$$isAssigned",
                      "$$isCreator",
                    ],
                  },
                  accessLevel: {
                    $switch: {
                      branches: [
                        { case: "$$isCreator", then: "owner" },
                        { case: "$$isAssigned", then: "assignee" },
                        { case: "$$isTabMember", then: "member" },
                        { case: "$$isChannelMember", then: "viewer" },
                      ],
                      default: "guest",
                    },
                  },
                  userRole: "$$currentUserInfo.role",
                },
              },
            },
          },
        },
        contextPath: {
          $concat: [
            "$channel.channelName",
            " / ",
            "$tab.tabName",
            " / ",
            "$project.name",
          ],
        },
      },
    },
    // Final projection
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        status: 1,
        priority: 1,
        dueDate: 1,
        tags: 1,
        strokeColor: 1,
        type: 1,
        attachments: 1,
        checklist: 1,
        customFields: 1,
        version: { $ifNull: ["$version", 0] },
        createdAt: 1,
        updatedAt: 1,
        projectId: 1,
        // Creator details
        createdBy: {
          _id: "$creator._id",
          name: "$creator.name",
          email: "$creator.email",
          role: "$creator.role",
        },
        // Assigned users details with roles
        assignedTo: {
          $map: {
            input: "$assignees",
            as: "assignee",
            in: {
              _id: "$$assignee._id",
              name: "$$assignee.name",
              email: "$$assignee.email",
              role: "$$assignee.role",
            },
          },
        },
        // Include subtasks array as is (already processed in lookup)
        subtasks: 1,
        // Include activities array (already processed in lookup)
        activities: 1,
        // Add context and permissions
        contextPath: 1,
        permissions: 1,
        // Project context info
        projectInfo: {
          _id: "$project._id",
          name: "$project.name",
          tabId: "$project.tabId",
          channelId: "$project.channelId",
        },
        tabInfo: {
          _id: "$tab._id",
          tabName: "$tab.tabName",
          isPrivate: "$tab.isPrivate",
        },
        channelInfo: {
          _id: "$channel._id",
          channelName: "$channel.channelName",
          isPrivate: "$channel.isPrivate",
        },
      },
    },
  ];
};
