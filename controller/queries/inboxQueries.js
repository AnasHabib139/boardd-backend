const { Types } = require("mongoose");

/**
 * Get user's important inbox tasks (assigned to user)
 * @param {string} userId - User ID
 * @returns {Array} Aggregation pipeline
 */
exports.getImportantInboxTasksQuery = (userId) => {
  return [
    // Match tasks assigned to user
    {
      $match: {
        isActive: true,
        assignedTo: Types.ObjectId.createFromHexString(userId)
      }
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
        // Custom title for important tasks
        customTitle: {
          $concat: [
            "\"", "$title", "\" task at ",
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

/**
 * Get user's outbox inbox tasks (created by user, assigned to others)
 * @param {string} userId - User ID
 * @returns {Array} Aggregation pipeline
 */
exports.getOutboxInboxTasksQuery = (userId) => {
  return [
    // Match tasks created by user (including self-assigned and unassigned)
    {
      $match: {
        isActive: true,
        createdBy: Types.ObjectId.createFromHexString(userId)
      }
    },
    // Lookup assignee details for custom title
    {
      $lookup: {
        from: "users",
        localField: "assignedTo",
        foreignField: "_id",
        as: "assignees",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1
            }
          }
        ]
      }
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
        // Custom title for outbox tasks: handle self-assignment, unassigned, and regular assignments
        customTitle: {
          $ifNull: [
            {
              $cond: {
            // Check if task has no assignees (unassigned)
            if: { 
              $or: [
                { $eq: [{ $ifNull: ["$assignedTo", []] }, []] },
                { $eq: [{ $size: { $ifNull: ["$assignedTo", []] } }, 0] }
              ]
            },
            then: {
              $concat: [
                "You created \"", { $ifNull: ["$title", "Untitled"] }, "\" at ",
                {
                  $ifNull: [
                    {
                      $cond: {
                        if: { $ne: ["$project", null] },
                        then: "$project.tab.channel.channelName",
                        else: "$directChannel.channelName"
                      }
                    },
                    "Unknown Channel"
                  ]
                }
              ]
            },
            else: {
              $cond: {
                // Check if assigned to self
                if: { $in: [Types.ObjectId.createFromHexString(userId), { $ifNull: ["$assignedTo", []] }] },
                then: {
                  $concat: [
                    "You assigned \"", { $ifNull: ["$title", "Untitled"] }, "\" to yourself at ",
                    {
                      $ifNull: [
                        {
                          $cond: {
                            if: { $ne: ["$project", null] },
                            then: "$project.tab.channel.channelName",
                            else: "$directChannel.channelName"
                          }
                        },
                        "Unknown Channel"
                      ]
                    }
                  ]
                },
                else: {
                  $concat: [
                    "You assigned \"", { $ifNull: ["$title", "Untitled"] }, "\" to ",
                    {
                      $cond: {
                        if: { $gt: [{ $size: { $ifNull: ["$assignees", []] } }, 0] },
                        then: {
                          $reduce: {
                            input: "$assignees",
                            initialValue: "",
                            in: {
                              $concat: [
                                "$$value",
                                {
                                  $cond: {
                                    if: { $eq: ["$$value", ""] },
                                    then: "",
                                    else: ", "
                                  }
                                },
                                { $ifNull: ["$$this.name", "Unknown User"] }
                              ]
                            }
                          }
                        },
                        else: "Unknown User"
                      }
                    },
                    " at ",
                    {
                      $ifNull: [
                        {
                          $cond: {
                            if: { $ne: ["$project", null] },
                            then: "$project.tab.channel.channelName",
                            else: "$directChannel.channelName"
                          }
                        },
                        "Unknown Channel"
                      ]
                    }
                  ]
                }
              }
            }
            }
          },
          "Unable to generate title"
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

/**
 * Get user's inbox tasks query with custom formatting (legacy function for compatibility)
 * @param {string} userId - User ID
 * @param {string} filter - Filter type: 'important', 'outbox', 'cleared'
 * @returns {Array} Aggregation pipeline
 */
exports.getUserInboxTasksQuery = (userId, filter = 'important') => {
  switch (filter) {
    case 'important':
      return exports.getImportantInboxTasksQuery(userId);
    case 'outbox':
      return exports.getOutboxInboxTasksQuery(userId);
    case 'cleared':
      // TODO: Implement cleared filter
      return exports.getImportantInboxTasksQuery(userId);
    default:
      return exports.getImportantInboxTasksQuery(userId);
  }
};