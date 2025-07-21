const { Types } = require("mongoose");

/**
 * Get tasks for calendar view of a tab (monthly view)
 * @param {string} channelId - Channel ID
 * @param {string} tabId - Tab ID
 * @param {string} userId - Current user ID
 * @param {Date} currentDate - Date for the month being viewed
 * @returns {Array} Aggregation pipeline
 */
exports.getTasksCalendarQuery = (channelId, tabId, userId, currentDate) => {
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
    // Match projects by channelId and tabId
    {
      $match: {
        channelId: Types.ObjectId.createFromHexString(channelId),
        tabId: Types.ObjectId.createFromHexString(tabId),
        status: "active", // Only active projects
      },
    },

    // Lookup tasks for these projects
    {
      $lookup: {
        from: "tasks",
        localField: "_id",
        foreignField: "projectId",
        as: "tasks",
        pipeline: [
          {
            $match: {
              isActive: true,
              // User must be assigned to task OR created the task
              $or: [
                { assignedTo: Types.ObjectId.createFromHexString(userId) },
                { createdBy: Types.ObjectId.createFromHexString(userId) },
              ],
              // Tasks due within the current month or overdue
              $or: [
                {
                  dueDate: {
                    $gte: monthStart,
                    $lte: monthEnd,
                  },
                },
                {
                  $and: [
                    { dueDate: { $lt: monthStart } }, // Overdue tasks
                    { status: { $ne: "completed" } }, // Not completed
                  ],
                },
              ],
            },
          },
          // Sort by dueDate
          {
            $sort: { dueDate: 1 },
          },
        ],
      },
    },

    // Unwind tasks to work with individual tasks
    {
      $unwind: {
        path: "$tasks",
        preserveNullAndEmptyArrays: false, // Only projects with tasks
      },
    },

    // Replace root with task data while preserving project info
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            "$tasks",
            {
              project: {
                _id: "$_id",
                name: "$name",
                color: "$color",
              },
            },
          ],
        },
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
                { $ne: ["$status", "completed"] },
              ],
            },
            then: true,
            else: false,
          },
        },
      },
    },

    // Project the final lightweight task structure
    {
      $project: {
        _id: 1,
        title: 1,
        status: 1,
        priority: 1,
        dueDate: 1,
        strokeColor: 1,
        isOverdue: 1,
        // Project context
        project: 1,
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

/**
 * Get projects overview of a tab (minimal data)
 * @param {string} channelId - Channel ID
 * @param {string} tabId - Tab ID
 * @returns {Array} Aggregation pipeline
 */
exports.getProjectsOverviewQuery = (channelId, tabId) => {
  return [
    // Match projects by channelId and tabId
    {
      $match: {
        channelId: Types.ObjectId.createFromHexString(channelId),
        tabId: Types.ObjectId.createFromHexString(tabId),
        status: "active", // Only active projects
      },
    },

    // Lookup company details for context path
    {
      $lookup: {
        from: "companies",
        localField: "companyId",
        foreignField: "_id",
        as: "company",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
            },
          },
        ],
      },
    },

    // Lookup project creator details
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

    // Lookup task counts for progress calculation (minimal lookup)
    {
      $lookup: {
        from: "tasks",
        localField: "_id",
        foreignField: "projectId",
        as: "taskCounts",
        pipeline: [
          {
            $match: {
              isActive: true,
            },
          },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ],
      },
    },

    // Calculate progress from task counts
    {
      $addFields: {
        taskStats: {
          $reduce: {
            input: "$taskCounts",
            initialValue: { total: 0, completed: 0 },
            in: {
              total: { $add: ["$$value.total", "$$this.count"] },
              completed: {
                $cond: [
                  { $eq: ["$$this._id", "completed"] },
                  { $add: ["$$value.completed", "$$this.count"] },
                  "$$value.completed",
                ],
              },
            },
          },
        },
      },
    },

    // Calculate progress percentage
    {
      $addFields: {
        progress: {
          $cond: [
            { $eq: ["$taskStats.total", 0] },
            0,
            {
              $multiply: [
                { $divide: ["$taskStats.completed", "$taskStats.total"] },
                100,
              ],
            },
          ],
        },
        taskCount: "$taskStats.total",
      },
    },

    // Unwind arrays to get single objects
    {
      $unwind: {
        path: "$creator",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$company",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Project final overview structure
    {
      $project: {
        _id: 1,
        name: 1,
        description: 1,
        status: 1,
        startDate: 1,
        endDate: 1,
        priority: 1,
        color: 1,
        createdAt: 1,
        updatedAt: 1,
        creator: 1,
        taskCount: 1,
        progress: {
          $round: ["$progress", 1], // Round to 1 decimal place
        },
        // Context path for overview
        contextPath: {
          $concat: [
            { $ifNull: ["$company.name", "Unknown Company"] },
            "/",
            "$name",
          ],
        },
      },
    },

    // Sort projects by priority and creation date
    {
      $sort: {
        priority: -1, // high, medium, low
        createdAt: -1, // newest first
      },
    },
  ];
};

/**
 * Get detailed projects of a tab with tasks
 * @param {string} channelId - Channel ID
 * @param {string} tabId - Tab ID
 * @returns {Array} Aggregation pipeline
 */
exports.getProjectsOfTabQuery = (channelId, tabId) => {
  return [
    // Match projects by channelId and tabId
    {
      $match: {
        channelId: Types.ObjectId.createFromHexString(channelId),
        tabId: Types.ObjectId.createFromHexString(tabId),
        status: "active", // Only active projects
      },
    },

    // Lookup company details for context path
    {
      $lookup: {
        from: "companies",
        localField: "companyId",
        foreignField: "_id",
        as: "company",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
            },
          },
        ],
      },
    },

    // Lookup project creator details
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

    // Lookup channel details
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
              channelName: 1,
            },
          },
        ],
      },
    },

    // Lookup tab details
    {
      $lookup: {
        from: "channeltabs",
        localField: "tabId",
        foreignField: "_id",
        as: "tab",
        pipeline: [
          {
            $project: {
              _id: 1,
              tabName: 1,
            },
          },
        ],
      },
    },

    // Lookup all tasks for this project
    {
      $lookup: {
        from: "tasks",
        localField: "_id",
        foreignField: "projectId",
        as: "allTasks",
        pipeline: [
          {
            $match: {
              isActive: true, // Only active tasks
            },
          },
          // Lookup task assignees
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
                    isDemo: 1,
                  },
                },
              ],
            },
          },
          // Lookup task creator
          {
            $lookup: {
              from: "users",
              localField: "createdBy",
              foreignField: "_id",
              as: "taskCreator",
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
          {
            $unwind: {
              path: "$taskCreator",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Project task fields - OPTIMIZED FOR LIST VIEW
          {
            $project: {
              _id: 1,
              title: 1,
              description: 1,
              projectId: "$projectId", // Already set by foreignField
              status: 1,
              priority: 1,
              dueDate: 1,
              strokeColor: 1,
              isActive: 1,
              orderIndex: 1,
              version: { $ifNull: ["$version", 0] },
              createdAt: 1,
              updatedAt: 1,
              // Assigned users - only essential details
              assignees: {
                $map: {
                  input: "$assignees",
                  as: "assignee",
                  in: {
                    _id: "$$assignee._id",
                    name: "$$assignee.name",
                    email: "$$assignee.email",
                  },
                },
              },
              // Task creator - only essential details
              createdBy: {
                _id: "$taskCreator._id",
                name: "$taskCreator.name",
                email: "$taskCreator.email",
              },
              // Computed fields for UI
              isOverdue: {
                $cond: {
                  if: {
                    $and: [
                      { $ne: ["$dueDate", null] },
                      { $lt: ["$dueDate", new Date()] },
                      { $ne: ["$status", "completed"] },
                    ],
                  },
                  then: true,
                  else: false,
                },
              },
            },
          },
          // Sort tasks by their status-specific orderIndex (handled in controller)
          {
            $sort: {
              createdAt: -1, // Fallback sort by creation date
            },
          },
        ],
      },
    },

    // Separate tasks by status for better organization
    {
      $addFields: {
        todoTasks: {
          $filter: {
            input: "$allTasks",
            cond: { $eq: ["$$this.status", "todo"] },
          },
        },
        inProgressTasks: {
          $filter: {
            input: "$allTasks",
            cond: { $eq: ["$$this.status", "in_progress"] },
          },
        },
        completedTasks: {
          $filter: {
            input: "$allTasks",
            cond: { $eq: ["$$this.status", "completed"] },
          },
        },
      },
    },

    // Calculate project statistics
    {
      $addFields: {
        taskStats: {
          total: { $size: "$allTasks" },
          todo: { $size: "$todoTasks" },
          inProgress: { $size: "$inProgressTasks" },
          completed: { $size: "$completedTasks" },
          overdue: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: {
                  $and: [
                    { $ne: ["$$this.dueDate", null] },
                    { $lt: ["$$this.dueDate", new Date()] },
                    { $ne: ["$$this.status", "completed"] },
                  ],
                },
              },
            },
          },
        },
      },
    },

    // Calculate progress percentage
    {
      $addFields: {
        progress: {
          $cond: [
            { $eq: ["$taskStats.total", 0] },
            0,
            {
              $multiply: [
                {
                  $divide: ["$taskStats.completed", "$taskStats.total"],
                },
                100,
              ],
            },
          ],
        },
      },
    },

    // Unwind arrays to get single objects
    {
      $unwind: {
        path: "$creator",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$company",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$channel",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$tab",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Final project structure
    {
      $project: {
        _id: 1,
        name: 1,
        description: 1,
        status: 1,
        startDate: 1,
        endDate: 1,
        priority: 1,
        color: 1,
        createdAt: 1,
        updatedAt: 1,
        creator: 1,
        channel: 1,
        tab: 1,
        todoTasks: 1,
        inProgressTasks: 1,
        completedTasks: 1,
        taskStats: 1,
        progress: {
          $round: ["$progress", 1], // Round to 1 decimal place
        },
        // Context path for projects: company/project
        contextPath: {
          $concat: [
            { $ifNull: ["$company.name", "Unknown Company"] },
            "/",
            "$name",
          ],
        },
        // Project status indicators
        isOverdue: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$endDate", null] },
                { $lt: ["$endDate", new Date()] },
                { $ne: ["$status", "completed"] },
              ],
            },
            then: true,
            else: false,
          },
        },
        daysUntilDue: {
          $cond: {
            if: { $ne: ["$endDate", null] },
            then: {
              $ceil: {
                $divide: [
                  { $subtract: ["$endDate", new Date()] },
                  1000 * 60 * 60 * 24, // Convert milliseconds to days
                ],
              },
            },
            else: null,
          },
        },
      },
    },

    // Sort projects by priority and due date
    {
      $sort: {
        priority: -1, // high, medium, low
        endDate: 1, // earliest first
        createdAt: -1, // newest first if no due date
      },
    },
  ];
};
