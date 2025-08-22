const { Types } = require("mongoose");

/**
 * Get user's inbox tasks query with custom formatting
 * @param {string} userId - User ID
 * @param {string} filter - Filter type: 'important', 'outbox', 'cleared'
 * @returns {Array} Aggregation pipeline
 */
exports.getUserInboxTasksQuery = (userId, filter = 'important') => {
  let matchStage = {};
  
  // Define match criteria based on filter
  switch (filter) {
    case 'important':
      // Tasks user is assigned to (not created by)
      matchStage = {
        isActive: true,
        assignedTo: Types.ObjectId.createFromHexString(userId)
      };
      break;
    case 'outbox':
      // Tasks user created (not assigned to)
      matchStage = {
        isActive: true,
        createdBy: Types.ObjectId.createFromHexString(userId),
        assignedTo: { $ne: Types.ObjectId.createFromHexString(userId) }
      };
      break;
    case 'cleared':
      // All tasks (will be filtered by inbox cleared status later)
      matchStage = {
        isActive: true,
        $or: [
          { assignedTo: Types.ObjectId.createFromHexString(userId) },
          { createdBy: Types.ObjectId.createFromHexString(userId) }
        ]
      };
      break;
    default:
      matchStage = {
        isActive: true,
        assignedTo: Types.ObjectId.createFromHexString(userId)
      };
  }
  
  return [
    // Match tasks based on filter
    {
      $match: matchStage
    },
    // Lookup project details for channel context
    {
      $lookup: {
        from: "projects",
        localField: "projectId",
        foreignField: "_id",
        as: "project",
        pipeline: [
          {
            $lookup: {
              from: "channeltabs",
              localField: "tabId", 
              foreignField: "_id",
              as: "tab",
              pipeline: [
                {
                  $lookup: {
                    from: "channels",
                    localField: "channelId",
                    foreignField: "_id", 
                    as: "channel",
                    pipeline: [
                      {
                        $project: {
                          _id: 1,
                          channelName: 1
                        }
                      }
                    ]
                  }
                },
                {
                  $unwind: {
                    path: "$channel",
                    preserveNullAndEmptyArrays: true
                  }
                }
              ]
            }
          },
          {
            $unwind: {
              path: "$tab",
              preserveNullAndEmptyArrays: true
            }
          }
        ]
      }
    },
    {
      $unwind: {
        path: "$project",
        preserveNullAndEmptyArrays: true
      }
    },
    // Lookup channel for non-project tasks
    {
      $lookup: {
        from: "channels",
        localField: "channelId",
        foreignField: "_id",
        as: "directChannel",
        pipeline: [
          {
            $project: {
              _id: 1,
              channelName: 1
            }
          }
        ]
      }
    },
    {
      $unwind: {
        path: "$directChannel",
        preserveNullAndEmptyArrays: true
      }
    },
    // Lookup existing inbox entry
    {
      $lookup: {
        from: "taskinboxes",
        let: { taskId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$taskId", "$$taskId"] },
                  { $eq: ["$userId", Types.ObjectId.createFromHexString(userId)] }
                ]
              }
            }
          }
        ],
        as: "inboxEntry"
      }
    },
    {
      $unwind: {
        path: "$inboxEntry", 
        preserveNullAndEmptyArrays: true
      }
    },
    // Add computed fields
    {
      $addFields: {
        // Custom title: "task title" task at "channel name"
        customTitle: {
          $concat: [
            "\"", "$title", "\"", " task at ",
            {
              $cond: {
                if: { $ne: ["$project", null] },
                then: "$project.tab.channel.channelName",
                else: "$directChannel.channelName"
              }
            }
          ]
        },
        // Check if task is overdue
        isOverdue: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$dueDate", null] },
                { $lt: ["$dueDate", new Date()] },
                { $ne: ["$status", "completed"] }
              ]
            },
            then: true,
            else: false
          }
        },
        // Format due date message
        dueDateMessage: {
          $cond: {
            if: { $ne: ["$dueDate", null] },
            then: {
              $cond: {
                if: {
                  $and: [
                    { $lt: ["$dueDate", new Date()] },
                    { $ne: ["$status", "completed"] }
                  ]
                },
                then: {
                  $concat: [
                    "Task is overdue due date was ",
                    {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: "$dueDate"
                      }
                    },
                    " at ",
                    {
                      $dateToString: {
                        format: "%H:%M",
                        date: "$dueDate"
                      }
                    }
                  ]
                },
                else: {
                  $concat: [
                    "Task is due on ",
                    {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: "$dueDate"
                      }
                    },
                    " at ",
                    {
                      $dateToString: {
                        format: "%H:%M",
                        date: "$dueDate"
                      }
                    }
                  ]
                }
              }
            },
            else: "No due date set"
          }
        },
        // Inbox entry fields
        isRead: { $ifNull: ["$inboxEntry.isRead", false] },
        isCleared: { $ifNull: ["$inboxEntry.isCleared", false] },
        inboxCreatedAt: { $ifNull: ["$inboxEntry.createdAt", null] }
      }
    },
    // Filter by cleared status for cleared filter
    ...(filter === 'cleared' ? [
      {
        $match: {
          isCleared: true
        }
      }
    ] : []),
    // Project final fields
    {
      $project: {
        _id: 1,
        title: 1,
        customTitle: 1,
        status: 1,
        priority: 1,
        dueDate: 1,
        isOverdue: 1,
        dueDateMessage: 1,
        isRead: 1,
        isCleared: 1,
        inboxCreatedAt: 1,
        createdAt: 1,
        // Flag to identify if inbox entry needs to be created
        needsInboxEntry: { $eq: ["$inboxEntry", null] }
      }
    },
    // Sort by inbox creation date (newest first), then by task creation date
    {
      $sort: {
        inboxCreatedAt: -1,
        createdAt: -1
      }
    }
  ];
};