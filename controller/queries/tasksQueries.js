const { Types } = require("mongoose");
const { TASK_STATUS } = require("../../utils/constants");

/**
 * Get user's personal tasks for calendar view (across all channels)
 * @param {string} userId - User ID
 * @param {Date} currentDate - Date for the month being viewed
 * @returns {Array} Aggregation pipeline
 */
exports.getUserPersonalTasksCalendarQuery = (userId, currentDate) => {
  // Calculate start and end of the month
  const monthStart = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  );
  const monthEnd = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );

  return [
    // Match tasks user is assigned to OR created by, due in the month
    {
      $match: {
        isActive: true,
        // User must be assigned to task OR created the task
        $or: [
          { assignedTo: Types.ObjectId.createFromHexString(userId) },
          { createdBy: Types.ObjectId.createFromHexString(userId) },
        ],
        // Tasks due within the current month only
        dueDate: {
          $gte: monthStart,
          $lte: monthEnd,
        },
      },
    },

    // Lookup project details for context
    {
      $lookup: {
        from: "projects",
        localField: "projectId",
        foreignField: "_id",
        as: "project",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              color: 1,
            },
          },
        ],
      },
    },

    {
      $unwind: {
        path: "$project",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Add computed fields for calendar
    {
      $addFields: {
        isOverdue: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$dueDate", null] },
                { $lt: ["$dueDate", new Date()] },
                { $ne: ["$isClosingStatus", true] },
              ],
            },
            then: true,
            else: false,
          },
        },
        // Add project context (or "Open" for non-project tasks)
        projectContext: {
          $cond: {
            if: { $ne: ["$project", null] },
            then: "$project",
            else: {
              _id: "open",
              name: "Uncategorized",
              color: "#808080",
            },
          },
        },
      },
    },

    // Filter out overdue tasks from calendar
    {
      $match: {
        isOverdue: false,
      },
    },

    // Project final lightweight task structure for calendar
    {
      $project: {
        _id: 1,
        title: 1,
        status: 1,
        priority: 1,
        dueDate: 1,
        strokeColor: 1,
        isOverdue: 1,
        project: "$projectContext",
      },
    },

    // Sort by due date
    {
      $sort: {
        dueDate: 1, // Earliest first
        priority: -1, // High priority first for same date
      },
    },
  ];
};

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
    // Lookup channel details (for project-based tasks via tab)
    {
      $lookup: {
        from: "channels",
        localField: "tab.channelId",
        foreignField: "_id",
        as: "channelFromTab",
      },
    },
    // Lookup channel details (for non-project tasks directly)
    {
      $lookup: {
        from: "channels",
        localField: "channelId",
        foreignField: "_id",
        as: "channelFromTask",
      },
    },
    // Merge channel data - use from tab if available, otherwise from task
    {
      $addFields: {
        channel: {
          $cond: {
            if: { $gt: [{ $size: "$channelFromTab" }, 0] },
            then: { $arrayElemAt: ["$channelFromTab", 0] },
            else: { $arrayElemAt: ["$channelFromTask", 0] },
          },
        },
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
          // Project subtask fields with proper assignee array
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
              links: 1,
              customFields: 1,
              checklist: 1,
              isActive: 1,
              isCompleted: 1,
              orderIndex: 1,
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
                    title: "$$assignee.title",
                    designation: "$$assignee.designation",
                    image: "$$assignee.image",
                    coverImage: "$$assignee.coverImage",
                    description: "$$assignee.description",
                    dob: "$$assignee.dob",
                    gender: "$$assignee.gender",
                    nickname: "$$assignee.nickname",
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
                title: "$user.title",
                designation: "$user.designation",
                image: "$user.image",
                coverImage: "$user.coverImage",
                description: "$user.description",
                dob: "$user.dob",
                gender: "$user.gender",
                nickname: "$user.nickname",
                role: "$user.role",
              },
            },
          },
          { $sort: { timestamp: -1 } },
        ],
        as: "activities",
      },
    },
    // Lookup task connections (bidirectional)
    {
      $lookup: {
        from: "taskconnections",
        let: { taskId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$sourceTaskId", "$$taskId"] },
                  { $eq: ["$targetTaskId", "$$taskId"] },
                ],
              },
            },
          },
          {
            $addFields: {
              connectedTaskId: {
                $cond: {
                  if: { $eq: ["$sourceTaskId", "$$taskId"] },
                  then: "$targetTaskId",
                  else: "$sourceTaskId",
                },
              },
            },
          },
          {
            $lookup: {
              from: "tasks",
              let: { connId: "$connectedTaskId" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$_id", "$$connId"] },
                    isActive: true,
                  },
                },
                { $project: { _id: 1, title: 1, status: 1, priority: 1, projectId: 1 } },
              ],
              as: "connectedTask",
            },
          },
          { $unwind: "$connectedTask" },
          {
            $lookup: {
              from: "tabtaskstatuses",
              let: {
                projId: "$connectedTask.projectId",
                sKey: "$connectedTask.status",
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$projectId", "$$projId"] },
                        { $eq: ["$statusKey", "$$sKey"] },
                      ],
                    },
                  },
                },
                { $project: { _id: 0, statusName: 1, color: 1 } },
              ],
              as: "statusInfo",
            },
          },
          {
            $unwind: {
              path: "$statusInfo",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 1,
              connectedTask: {
                _id: "$connectedTask._id",
                title: "$connectedTask.title",
                status: { $ifNull: ["$statusInfo.statusName", "$connectedTask.status"] },
                statusColor: { $ifNull: ["$statusInfo.color", null] },
                priority: "$connectedTask.priority",
              },
              createdAt: 1,
            },
          },
          { $sort: { createdAt: -1 } },
        ],
        as: "connections",
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
                    $in: [{ $toObjectId: userId }, { $ifNull: ["$channel.members", []] }],
                  },
                  isTabMember: {
                    $in: [{ $toObjectId: userId }, { $ifNull: ["$tab.members", []] }],
                  },
                  isAssigned: {
                    $in: [{ $toObjectId: userId }, { $ifNull: ["$assignedTo", []] }],
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
            { $ifNull: ["$channel.channelName", "Unknown Channel"] },
            " / ",
            { $ifNull: ["$tab.tabName", "Unknown Tab"] },
            " / ",
            { $ifNull: ["$project.name", "Uncategorized"] },
          ],
        },
      },
    },
    // Remove temporary fields
    {
      $unset: ["channelFromTab", "channelFromTask"],
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
        channelId: 1,
        tabId: 1,
        statusColumnValues: 1,
        // Creator details
        createdBy: {
          _id: "$creator._id",
          name: "$creator.name",
          email: "$creator.email",
          title: "$creator.title",
          designation: "$creator.designation",
          image: "$creator.image",
          coverImage: "$creator.coverImage",
          description: "$creator.description",
          dob: "$creator.dob",
          gender: "$creator.gender",
          nickname: "$creator.nickname",
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
              title: "$$assignee.title",
              designation: "$$assignee.designation",
              image: "$$assignee.image",
              coverImage: "$$assignee.coverImage",
              description: "$$assignee.description",
              dob: "$$assignee.dob",
              gender: "$$assignee.gender",
              nickname: "$$assignee.nickname",
              role: "$$assignee.role",
            },
          },
        },
        // Include subtasks array as is (already processed in lookup)
        subtasks: 1,
        // Include activities array (already processed in lookup)
        activities: 1,
        // Include connections array (bidirectional task links)
        connections: 1,
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

exports.getTrendingTasksQuery = (userId, { timeframe = 'all', projectId, channelId } = {}) => {
  const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  
  const query = [
    // Start with task views for this user
    {
      $match: {
        userId: userObjectId,
        clickCount: { $gte: 1 }, // Show tasks clicked at least once
      },
    },
  ];

  // Add timeframe filter if specified
  if (timeframe && timeframe !== 'all') {
    const now = new Date();
    let startDate;
    
    switch (timeframe) {
      case 'day':
        startDate = new Date(now.setDate(now.getDate() - 1));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
    }
    
    if (startDate) {
      query.push({
        $match: {
          lastViewedAt: { $gte: startDate }
        }
      });
    }
  }

  // Lookup the actual task and filter active incomplete tasks
  query.push(
    {
      $lookup: {
        from: "tasks",
        localField: "taskId",
        foreignField: "_id",
        as: "task",
        pipeline: [{ 
          $match: { 
            isActive: true,
            status: { 
              $in: [
                TASK_STATUS.TODO,
                TASK_STATUS.IN_PROGRESS,
              ]
            }
          } 
        }],
      },
    },
    {
      $unwind: "$task",
    }
  );

  // Add filters if provided
  if (projectId) {
    query.push({
      $match: {
        "task.projectId": new Types.ObjectId(projectId)
      }
    });
  }

  if (channelId) {
    query.push({
      $match: {
        "task.channelId": new Types.ObjectId(channelId)
      }
    });
  }

  // Lookup project, tab, and channel for context
  query.push(
    {
      $lookup: {
        from: "projects",
        localField: "task.projectId",
        foreignField: "_id",
        as: "project",
      },
    },
    {
      $addFields: {
        project: { $arrayElemAt: ["$project", 0] },
      },
    },
    {
      $addFields: {
        tabIdToLookup: {
          $cond: {
            if: { $ifNull: ["$project", false] },
            then: "$project.tabId",
            else: "$task.tabId",
          },
        },
      },
    },
    {
      $lookup: {
        from: "channeltabs",
        localField: "tabIdToLookup",
        foreignField: "_id",
        as: "tab",
      },
    },
    {
      $addFields: {
        tab: { $arrayElemAt: ["$tab", 0] },
      },
    },
    {
      $addFields: {
        channelIdToLookup: {
          $cond: {
            if: { $ifNull: ["$tab", false] },
            then: "$tab.channelId",
            else: "$task.channelId",
          },
        },
      },
    },
    {
      $lookup: {
        from: "channels",
        localField: "channelIdToLookup",
        foreignField: "_id",
        as: "channel",
      },
    },
    {
      $addFields: {
        channel: { $arrayElemAt: ["$channel", 0] },
      },
    }
  );

  // Filter tasks user has access to
  query.push({
    $match: {
      $or: [
        { "task.assignedTo": userObjectId },
        { "task.createdBy": userObjectId },
        { "tab.members": userObjectId },
        { "channel.members": userObjectId },
      ],
    },
  });

  // Lookup task creator
  query.push(
    {
      $lookup: {
        from: "users",
        localField: "task.createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    {
      $addFields: {
        creator: { $arrayElemAt: ["$creator", 0] },
      },
    }
  );

  // Lookup activities (top 2 recent activities per task)
  query.push({
    $lookup: {
      from: "activities",
      let: { taskId: "$task._id" },
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
        { $limit: 2 }, // Only top 2 recent activities
      ],
      as: "activities",
    },
  });

  // Final projection
  query.push({
    $project: {
      _id: "$task._id",
      title: "$task.title",
      description: "$task.description",
      status: "$task.status",
      priority: "$task.priority",
      dueDate: "$task.dueDate",
      clickCount: 1,
      lastViewedAt: 1,
      firstViewedAt: 1,
      contextPath: {
        $cond: {
          if: { $ifNull: ["$project", false] },
          then: {
            $concat: [
              { $ifNull: ["$channel.channelName", "Unknown Channel"] },
              " / ",
              { $ifNull: ["$tab.tabName", "Unknown Tab"] },
              " / ",
              { $ifNull: ["$project.name", "Project"] },
            ],
          },
          else: {
            $concat: [
              { $ifNull: ["$channel.channelName", "Unknown Channel"] },
              " / Open",
            ],
          },
        },
      },
      creator: {
        _id: "$creator._id",
        name: "$creator.name",
        email: "$creator.email",
        title: "$creator.title",
        designation: "$creator.designation",
        image: "$creator.image",
        coverImage: "$creator.coverImage",
        description: "$creator.description",
        dob: "$creator.dob",
        gender: "$creator.gender",
        nickname: "$creator.nickname",
      },
      activities: 1, // Include the activities array (already processed in lookup)
    },
  });

  return query;
};

exports.getRecentActivitiesQuery = (userId, { projectId, channelId } = {}) => {
  const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  
  const query = [
    // Start with task views for this user (all viewed tasks)
    {
      $match: {
        userId: userObjectId,
      },
    },
  ];

  // Lookup the actual task and filter active tasks (including completed ones for recent activities)
  query.push(
    {
      $lookup: {
        from: "tasks",
        localField: "taskId",
        foreignField: "_id",
        as: "task",
        pipeline: [{ 
          $match: { 
            isActive: true, // Only active tasks, but all statuses
          } 
        }],
      },
    },
    {
      $unwind: "$task",
    }
  );

  // Add filters if provided
  if (projectId) {
    query.push({
      $match: {
        "task.projectId": new Types.ObjectId(projectId)
      }
    });
  }

  if (channelId) {
    query.push({
      $match: {
        "task.channelId": new Types.ObjectId(channelId)
      }
    });
  }

  // Lookup project, tab, and channel for context
  query.push(
    {
      $lookup: {
        from: "projects",
        localField: "task.projectId",
        foreignField: "_id",
        as: "project",
      },
    },
    {
      $addFields: {
        project: { $arrayElemAt: ["$project", 0] },
      },
    },
    {
      $addFields: {
        tabIdToLookup: {
          $cond: {
            if: { $ifNull: ["$project", false] },
            then: "$project.tabId",
            else: "$task.tabId",
          },
        },
      },
    },
    {
      $lookup: {
        from: "channeltabs",
        localField: "tabIdToLookup",
        foreignField: "_id",
        as: "tab",
      },
    },
    {
      $addFields: {
        tab: { $arrayElemAt: ["$tab", 0] },
      },
    },
    {
      $addFields: {
        channelIdToLookup: {
          $cond: {
            if: { $ifNull: ["$tab", false] },
            then: "$tab.channelId",
            else: "$task.channelId",
          },
        },
      },
    },
    {
      $lookup: {
        from: "channels",
        localField: "channelIdToLookup",
        foreignField: "_id",
        as: "channel",
      },
    },
    {
      $addFields: {
        channel: { $arrayElemAt: ["$channel", 0] },
      },
    }
  );

  // Filter tasks user has access to
  query.push({
    $match: {
      $or: [
        { "task.assignedTo": userObjectId },
        { "task.createdBy": userObjectId },
        { "tab.members": userObjectId },
        { "channel.members": userObjectId },
      ],
    },
  });

  // Lookup task creator
  query.push(
    {
      $lookup: {
        from: "users",
        localField: "task.createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    {
      $addFields: {
        creator: { $arrayElemAt: ["$creator", 0] },
      },
    }
  );

  // Lookup activities (top 2 recent activities per task)
  query.push({
    $lookup: {
      from: "activities",
      let: { taskId: "$task._id" },
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
        { $limit: 2 }, // Only top 2 recent activities
      ],
      as: "activities",
    },
  });

  // Final projection
  query.push({
    $project: {
      _id: "$task._id",
      title: "$task.title",
      description: "$task.description",
      status: "$task.status",
      priority: "$task.priority",
      dueDate: "$task.dueDate",
      clickCount: 1,
      lastViewedAt: 1,
      firstViewedAt: 1,
      contextPath: {
        $cond: {
          if: { $ifNull: ["$project", false] },
          then: {
            $concat: [
              { $ifNull: ["$channel.channelName", "Unknown Channel"] },
              " / ",
              { $ifNull: ["$tab.tabName", "Unknown Tab"] },
              " / ",
              { $ifNull: ["$project.name", "Project"] },
            ],
          },
          else: {
            $concat: [
              { $ifNull: ["$channel.channelName", "Unknown Channel"] },
              " / Open",
            ],
          },
        },
      },
      creator: {
        _id: "$creator._id",
        name: "$creator.name",
        email: "$creator.email",
        title: "$creator.title",
        designation: "$creator.designation",
        image: "$creator.image",
        coverImage: "$creator.coverImage",
        description: "$creator.description",
        dob: "$creator.dob",
        gender: "$creator.gender",
        nickname: "$creator.nickname",
      },
      activities: 1, // Include the activities array (already processed in lookup)
    },
  });

  return query;
};

exports.getUserTasksByFilterQuery = (userId, filter) => {
  const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const lastWeekStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  let query = [];

  if (filter === 'yesterday') {
    // For yesterday - find tasks completed yesterday through activities
    query = [
      {
        $match: {
          isActive: true,
          isClosingStatus: true,
          // Simple access: only tasks assigned to me or created by me
          $or: [
            { assignedTo: userObjectId },
            { createdBy: userObjectId },
          ],
        },
      },
      // Resolve which statusKeys close a task for this task's project
      // (channel-only tasks have projectId: null → lookup returns [], and
      // the $or fallback below covers them via the literal "completed" check)
      {
        $lookup: {
          from: "tabtaskstatuses",
          let: { projectId: "$projectId" },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ["$projectId", "$$projectId"] }, { $eq: ["$isCompletedStatus", true] }] },
              },
            },
            { $project: { _id: 0, statusKey: 1 } },
          ],
          as: "closingStatuses",
        },
      },
      // Lookup activities to find completion timestamp
      {
        $lookup: {
          from: "activities",
          let: { taskId: "$_id", closingKeys: "$closingStatuses.statusKey" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$taskId", "$$taskId"] },
                    { $eq: ["$field", "status"] },
                    { $or: [{ $eq: ["$newValue", "completed"] }, { $in: ["$newValue", "$$closingKeys"] }] },
                    { $gte: ["$timestamp", yesterday] },
                    { $lt: ["$timestamp", today] },
                  ]
                }
              }
            },
            { $sort: { timestamp: -1 } },
            { $limit: 1 }
          ],
          as: "completionActivity"
        }
      },
      {
        $match: {
          "completionActivity.0": { $exists: true }
        }
      },
      {
        $addFields: {
          completedAt: { $arrayElemAt: ["$completionActivity.timestamp", 0] }
        }
      }
    ];
  } else if (filter === 'lastweek') {
    // For last week - find tasks completed in the last 7 days through activities
    query = [
      {
        $match: {
          isActive: true,
          isClosingStatus: true,
          // Simple access: only tasks assigned to me or created by me
          $or: [
            { assignedTo: userObjectId },
            { createdBy: userObjectId },
          ],
        },
      },
      {
        $lookup: {
          from: "tabtaskstatuses",
          let: { projectId: "$projectId" },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ["$projectId", "$$projectId"] }, { $eq: ["$isCompletedStatus", true] }] },
              },
            },
            { $project: { _id: 0, statusKey: 1 } },
          ],
          as: "closingStatuses",
        },
      },
      // Lookup activities to find completion timestamp
      {
        $lookup: {
          from: "activities",
          let: { taskId: "$_id", closingKeys: "$closingStatuses.statusKey" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$taskId", "$$taskId"] },
                    { $eq: ["$field", "status"] },
                    { $or: [{ $eq: ["$newValue", "completed"] }, { $in: ["$newValue", "$$closingKeys"] }] },
                    { $gte: ["$timestamp", lastWeekStart] },
                    { $lt: ["$timestamp", today] },
                  ]
                }
              }
            },
            { $sort: { timestamp: -1 } },
            { $limit: 1 }
          ],
          as: "completionActivity"
        }
      },
      {
        $match: {
          "completionActivity.0": { $exists: true }
        }
      },
      {
        $addFields: {
          completedAt: { $arrayElemAt: ["$completionActivity.timestamp", 0] }
        }
      }
    ];
  } else {
    // For today and overdue - filter by due date
    let dateFilter = {};
    
    if (filter === 'today') {
      dateFilter = {
        dueDate: {
          $gte: today,
          $lt: tomorrow
        }
      };
    } else if (filter === 'overdue') {
      dateFilter = {
        dueDate: { $lt: today }
      };
    }

    query = [
      {
        $match: {
          isActive: true,
          isClosingStatus: { $ne: true }, // Not completed for today/overdue
          ...dateFilter,
          // Simple access: only tasks assigned to me or created by me
          $or: [
            { assignedTo: userObjectId },
            { createdBy: userObjectId },
          ],
        },
      }
    ];
  }

  // Common lookups for context path
  query.push(
    // Lookup project
    {
      $lookup: {
        from: "projects",
        localField: "projectId",
        foreignField: "_id",
        as: "project",
      },
    },
    {
      $addFields: {
        project: { $arrayElemAt: ["$project", 0] },
      },
    },
    // Lookup tab
    {
      $addFields: {
        tabIdToLookup: {
          $cond: {
            if: { $ifNull: ["$project", false] },
            then: "$project.tabId",
            else: "$tabId",
          },
        },
      },
    },
    {
      $lookup: {
        from: "channeltabs",
        localField: "tabIdToLookup",
        foreignField: "_id",
        as: "tab",
      },
    },
    {
      $addFields: {
        tab: { $arrayElemAt: ["$tab", 0] },
      },
    },
    // Lookup channel
    {
      $addFields: {
        channelIdToLookup: {
          $cond: {
            if: { $ifNull: ["$tab", false] },
            then: "$tab.channelId",
            else: "$channelId",
          },
        },
      },
    },
    {
      $lookup: {
        from: "channels",
        localField: "channelIdToLookup",
        foreignField: "_id",
        as: "channel",
      },
    },
    {
      $addFields: {
        channel: { $arrayElemAt: ["$channel", 0] },
      },
    }
  );

  // No additional access filter needed - already filtered by assignedTo/createdBy

  // Final projection
  const baseProjection = {
    _id: 1,
    title: 1,
    contextPath: {
      $cond: {
        if: { $ifNull: ["$project", false] },
        then: {
          $concat: [
            { $ifNull: ["$channel.channelName", "Unknown Channel"] },
            " / ",
            { $ifNull: ["$tab.tabName", "Unknown Tab"] },
            " / ",
            { $ifNull: ["$project.name", "Project"] },
          ],
        },
        else: {
          $concat: [
            { $ifNull: ["$channel.channelName", "Unknown Channel"] },
            " / Open",
          ],
        },
      },
    },
  };

  if (filter === 'yesterday' || filter === 'lastweek') {
    baseProjection.completedAt = 1;
  } else {
    baseProjection.dueDate = 1;
  }

  query.push({
    $project: baseProjection,
  });

  return query;
};