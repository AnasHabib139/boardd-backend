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
    // Filter out cleared tasks
    {
      $match: {
        $or: [
          { "inboxEntry.isCleared": { $ne: true } },
          { "inboxEntry": null }
        ]
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
              email: 1,
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1
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
    // Filter out cleared tasks
    {
      $match: {
        $or: [
          { "inboxEntry.isCleared": { $ne: true } },
          { "inboxEntry": null }
        ]
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
 * Get user's cleared inbox tasks (isCleared: true from inbox entries)
 * @param {string} userId - User ID
 * @returns {Array} Aggregation pipeline
 */
exports.getClearedInboxTasksQuery = (userId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return [
    // Start from taskinboxes collection and match cleared entries for user
    // Only show items cleared within the last 30 days
    {
      $match: {
        userId: Types.ObjectId.createFromHexString(userId),
        isCleared: true,
        clearedAt: { $gte: thirtyDaysAgo }
      }
    },
    // Lookup task details
    {
      $lookup: {
        from: "tasks",
        localField: "taskId",
        foreignField: "_id",
        as: "task"
      }
    },
    {
      $unwind: {
        path: "$task",
        preserveNullAndEmptyArrays: false // Only include if task exists
      }
    },
    // Filter for active tasks only
    {
      $match: {
        "task.isActive": true
      }
    },
    // Lookup project details for channel context
    {
      $lookup: {
        from: "projects",
        localField: "task.projectId",
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
        localField: "task.channelId",
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
    // Lookup assignee details for custom title (in case it's an outbox task)
    {
      $lookup: {
        from: "users",
        localField: "task.assignedTo",
        foreignField: "_id",
        as: "assignees",
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
              nickname: 1
            }
          }
        ]
      }
    },
    // Add computed fields
    {
      $addFields: {
        // Determine if this was an important or outbox task for custom title
        isImportantTask: {
          $cond: {
            if: { $in: [Types.ObjectId.createFromHexString(userId), { $ifNull: ["$task.assignedTo", []] }] },
            then: true,
            else: false
          }
        },
        isOutboxTask: {
          $eq: ["$task.createdBy", Types.ObjectId.createFromHexString(userId)]
        },
        // Custom title based on task type
        customTitle: {
          $cond: {
            // If user is assigned to the task (important task)
            if: { $in: [Types.ObjectId.createFromHexString(userId), { $ifNull: ["$task.assignedTo", []] }] },
            then: {
              $concat: [
                "\"", { $ifNull: ["$task.title", "Untitled"] }, "\" task at ",
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
            // Otherwise it's an outbox task
            else: {
              $cond: {
                // Check if task has no assignees (unassigned)
                if: { 
                  $or: [
                    { $eq: [{ $ifNull: ["$task.assignedTo", []] }, []] },
                    { $eq: [{ $size: { $ifNull: ["$task.assignedTo", []] } }, 0] }
                  ]
                },
                then: {
                  $concat: [
                    "You created \"", { $ifNull: ["$task.title", "Untitled"] }, "\" at ",
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
                    if: { $in: [Types.ObjectId.createFromHexString(userId), { $ifNull: ["$task.assignedTo", []] }] },
                    then: {
                      $concat: [
                        "You assigned \"", { $ifNull: ["$task.title", "Untitled"] }, "\" to yourself at ",
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
                        "You assigned \"", { $ifNull: ["$task.title", "Untitled"] }, "\" to ",
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
            }
          }
        },
        // Check if task is overdue
        isOverdue: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$task.dueDate", null] },
                { $lt: ["$task.dueDate", new Date()] },
                { $ne: ["$task.status", "completed"] }
              ]
            },
            then: true,
            else: false
          }
        },
        // Format due date message
        dueDateMessage: {
          $cond: {
            if: { $ne: ["$task.dueDate", null] },
            then: {
              $cond: {
                if: {
                  $and: [
                    { $lt: ["$task.dueDate", new Date()] },
                    { $ne: ["$task.status", "completed"] }
                  ]
                },
                then: {
                  $concat: [
                    "Task is overdue due date was ",
                    {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: "$task.dueDate"
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
                        date: "$task.dueDate"
                      }
                    }
                  ]
                }
              }
            },
            else: "No due date set"
          }
        }
      }
    },
    // Project final fields
    {
      $project: {
        _id: "$task._id",
        title: "$task.title",
        customTitle: 1,
        status: "$task.status",
        priority: "$task.priority",
        dueDate: "$task.dueDate",
        isOverdue: 1,
        dueDateMessage: 1,
        isRead: 1,
        isCleared: 1,
        inboxCreatedAt: "$createdAt",
        createdAt: "$task.createdAt",
        isImportantTask: 1,
        isOutboxTask: 1,
        needsInboxEntry: { $literal: false }
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
      return exports.getClearedInboxTasksQuery(userId);
    default:
      return exports.getImportantInboxTasksQuery(userId);
  }
};

/**
 * Lightweight count of unread important inbox tasks (assigned to user, not cleared, not read)
 * @param {string} userId - User ID
 * @returns {Array} Aggregation pipeline ending with $count
 */
exports.getImportantInboxUnreadCountQuery = (userId) => {
  return [
    {
      $match: {
        isActive: true,
        assignedTo: Types.ObjectId.createFromHexString(userId),
      },
    },
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
                  {
                    $eq: [
                      "$userId",
                      Types.ObjectId.createFromHexString(userId),
                    ],
                  },
                ],
              },
            },
          },
        ],
        as: "inboxEntry",
      },
    },
    {
      $unwind: {
        path: "$inboxEntry",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $and: [
          // Not cleared
          {
            $or: [
              { "inboxEntry.isCleared": { $ne: true } },
              { inboxEntry: null },
            ],
          },
          // Not read
          {
            $or: [
              { "inboxEntry.isRead": { $ne: true } },
              { inboxEntry: null },
            ],
          },
        ],
      },
    },
    { $count: "count" },
  ];
};

/**
 * Lightweight count of unread outbox inbox tasks (created by user, not cleared, not read)
 * @param {string} userId - User ID
 * @returns {Array} Aggregation pipeline ending with $count
 */
exports.getOutboxInboxUnreadCountQuery = (userId) => {
  return [
    {
      $match: {
        isActive: true,
        createdBy: Types.ObjectId.createFromHexString(userId),
      },
    },
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
                  {
                    $eq: [
                      "$userId",
                      Types.ObjectId.createFromHexString(userId),
                    ],
                  },
                ],
              },
            },
          },
        ],
        as: "inboxEntry",
      },
    },
    {
      $unwind: {
        path: "$inboxEntry",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $and: [
          // Not cleared
          {
            $or: [
              { "inboxEntry.isCleared": { $ne: true } },
              { inboxEntry: null },
            ],
          },
          // Not read
          {
            $or: [
              { "inboxEntry.isRead": { $ne: true } },
              { inboxEntry: null },
            ],
          },
        ],
      },
    },
    { $count: "count" },
  ];
};