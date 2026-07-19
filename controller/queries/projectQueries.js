const { Types } = require("mongoose");

/**
 * Get tasks for calendar view of a tab (monthly view)
 * @param {string} channelId - Channel ID
 * @param {string} tabId - Tab ID
 * @param {string} userId - Current user ID
 * @param {Date} currentDate - Date for the month being viewed
 * @param {string} search - Optional search term for task title
 * @returns {Array} Aggregation pipeline
 */
exports.getTasksCalendarQuery = (channelId, tabId, userId, currentDate, search = null, priority = null) => {
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
    // Use a facet to combine project-based tasks and channel-based tasks
    {
      $facet: {
        // Project-based tasks
        projectTasks: [
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
                    // Tasks due within the current month only
                    dueDate: {
                      $gte: monthStart,
                      $lte: monthEnd,
                    },
                    // Add search condition for task title if provided
                    ...(search && search.trim() ? { title: { $regex: search.trim(), $options: "i" } } : {}),
                    // Add priority filter if provided
                    ...(priority ? { priority } : {}),
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
        ],

        // Channel-based tasks (without project)
        channelTasks: [
          // Start with a dummy document to use the facet
          { $limit: 1 },
          
          // Lookup tasks directly from the tasks collection
          {
            $lookup: {
              from: "tasks",
              pipeline: [
                {
                  $match: {
                    channelId: Types.ObjectId.createFromHexString(channelId),
                    projectId: null, // Tasks without project
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
                    // Add search condition for task title if provided
                    ...(search && search.trim() ? { title: { $regex: search.trim(), $options: "i" } } : {}),
                    // Add priority filter if provided
                    ...(priority ? { priority } : {}),
                  },
                },
                // Sort by dueDate
                {
                  $sort: { dueDate: 1 },
                },
              ],
              as: "tasks",
            },
          },

          // Unwind tasks
          {
            $unwind: {
              path: "$tasks",
              preserveNullAndEmptyArrays: false,
            },
          },

          // Replace root with task data and add Open project info
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: [
                  "$tasks",
                  {
                    project: {
                      _id: "open",
                      name: "Uncategorized",
                      color: "#808080",
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },

    // Combine both arrays into a single array
    {
      $project: {
        allTasks: {
          $concatArrays: ["$projectTasks", "$channelTasks"],
        },
      },
    },

    // Unwind the combined array
    {
      $unwind: {
        path: "$allTasks",
        preserveNullAndEmptyArrays: false,
      },
    },

    // Replace root with the task data
    {
      $replaceRoot: {
        newRoot: "$allTasks",
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
      },
    },

    // Note: Calendar shows all tasks for the month (including overdue)
    // {
    //   $match: {
    //     isOverdue: false,
    //   },
    // },

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
 * @param {string} search - Optional search term for project name
 * @returns {Array} Aggregation pipeline
 */
exports.getProjectsOverviewQuery = (channelId, tabId, search = null) => {
  const pipeline = [
    // Match projects by channelId and tabId
    {
      $match: {
        channelId: Types.ObjectId.createFromHexString(channelId),
        tabId: Types.ObjectId.createFromHexString(tabId),
        status: "active", // Only active projects
      },
    },
  ];

  // Add search filter if search term is provided
  if (search && search.trim()) {
    pipeline.push({
      $match: {
        name: { $regex: search.trim(), $options: "i" }
      }
    });
  }

  pipeline.push(

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
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
            },
          },
        ],
      },
    },

    // Lookup task counts and attachment counts for progress calculation
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
              isClosingStatus: { $first: "$isClosingStatus" },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },

    // Lookup all tasks to calculate attachment counts
    {
      $lookup: {
        from: "tasks",
        localField: "_id",
        foreignField: "projectId",
        as: "allProjectTasks",
        pipeline: [
          {
            $match: {
              isActive: true,
            },
          },
          {
            $project: {
              attachments: { $ifNull: ["$attachments", []] }, // Default to empty array if null/undefined
              links: { $ifNull: ["$links", []] }, // Default to empty array if null/undefined
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
                  { $eq: ["$$this.isClosingStatus", true] },
                  { $add: ["$$value.completed", "$$this.count"] },
                  "$$value.completed",
                ],
              },
            },
          },
        },
        // Calculate file and link attachment counts using separate fields
        fileAttached: {
          $reduce: {
            input: "$allProjectTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", { $size: "$$this.attachments" }]
            }
          }
        },
        linksAttached: {
          $reduce: {
            input: "$allProjectTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", { $size: "$$this.links" }]
            }
          }
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

    // Add default value for isPinned if missing
    {
      $addFields: {
        isPinned: { $ifNull: ["$isPinned", false] },
      },
    },
  );

  // Add search score calculation if search is provided
  if (search && search.trim()) {
    pipeline.push({
      $addFields: {
        searchScore: {
          $subtract: [100, { $strLenCP: "$name" }]
        }
      }
    });
  }

  pipeline.push({
    // Project final overview structure
    $project: {
        _id: 1,
        name: 1,
        description: 1,
        status: 1,
        startDate: 1,
        endDate: 1,
        priority: 1,
        color: 1,
        isPinned: 1,
        orderIndex: 1,
        createdAt: 1,
        updatedAt: 1,
        creator: 1,
        taskCount: 1,
        progress: {
          $round: ["$progress", 1], // Round to 1 decimal place
        },
        fileAttached: 1,
        linksAttached: 1,
        // Context path for overview
        contextPath: {
          $concat: [
            { $ifNull: ["$company.name", "Unknown Company"] },
            "/",
            "$name",
          ],
        },
        // Include searchScore if it exists
        ...(search && search.trim() ? { searchScore: 1 } : {}),
    }
  });

  return pipeline;
};

/**
 * Get project board view with tasks organized by status
 * @param {string} projectId - Project ID
 * @param {string} search - Optional search term for task title
 * @returns {Array} Aggregation pipeline
 */
exports.getProjectBoardQuery = (projectId, search = null) => {
  return [
    // Match the specific project
    {
      $match: {
        _id: Types.ObjectId.createFromHexString(projectId),
        status: "active", // Only active projects
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
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
            },
          },
        ],
      },
    },

    // Lookup project statuses for dynamic status grouping
    {
      $lookup: {
        from: "tabtaskstatuses",
        localField: "_id",
        foreignField: "projectId",
        as: "projectStatuses",
        pipeline: [
          { $match: { isActive: true } },
          { $sort: { order: 1 } },
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
              // Add search condition for task title if provided
              ...(search && search.trim() ? { title: { $regex: search.trim(), $options: "i" } } : {}),
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
                    title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
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
                    title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
                  },
                },
              ],
            },
          },
          // Unwind task creator
          {
            $unwind: {
              path: "$taskCreator",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Add computed fields including attachment counts and cover
          {
            $addFields: {
              // Add attachment and link counts
              fileCount: { $size: { $ifNull: ["$attachments", []] } },
              linkCount: { $size: { $ifNull: ["$links", []] } },
              // Add coverLink (first link) - get the first element of links array
              coverLink: { $arrayElemAt: [{ $ifNull: ["$links", []] }, 0] },
              // Add coverImage - first image file from attachments
              coverImage: {
                $let: {
                  vars: {
                    imageFiles: {
                      $filter: {
                        input: { $ifNull: ["$attachments", []] },
                        cond: {
                          $regexMatch: {
                            input: "$$this.url",
                            regex: /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i
                          }
                        }
                      }
                    }
                  },
                  in: {
                    $cond: {
                      if: { $gt: [{ $size: "$$imageFiles" }, 0] },
                      then: { $arrayElemAt: ["$$imageFiles", 0] },
                      else: ""
                    }
                  }
                }
              },
              // Computed fields for UI
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
            },
          },
          // Project task fields for board view
          {
            $project: {
              _id: 1,
              title: 1,
              description: 1,
              status: 1,
              priority: 1,
              dueDate: 1,
              strokeColor: 1,
              isActive: 1,
              orderIndex: 1,
              version: { $ifNull: ["$version", 0] },
              createdAt: 1,
              updatedAt: 1,
              // Task creator with profile image
              createdBy: {
                _id: "$taskCreator._id",
                name: "$taskCreator.name",
                email: "$taskCreator.email",
                profileImage: "$taskCreator.profileImage",
              },
              // Assignees with profile images
              assignees: 1,
              // Computed fields
              isOverdue: 1,
              tags: 1,
              fileCount: 1,
              linkCount: 1,
              coverLink: 1,
              coverImage: 1,
            },
          },
        ],
      },
    },

    // Dynamic status grouping for custom statuses
    {
      $addFields: {
        tasksByStatus: {
          $map: {
            input: "$projectStatuses",
            as: "status",
            in: {
              _id: "$$status._id",
              statusKey: "$$status.statusKey",
              statusName: "$$status.statusName",
              color: "$$status.color",
              order: "$$status.order",
              isSystem: "$$status.isSystem",
              tasks: {
                $filter: {
                  input: "$allTasks",
                  cond: { $eq: ["$$this.status", "$$status.statusKey"] },
                },
              },
            },
          },
        },
      },
    },

    // Calculate task statistics
    {
      $addFields: {
        taskStats: {
          total: { $size: "$allTasks" },
          todo: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: { $eq: ["$$this.status", "todo"] },
              },
            },
          },
          inProgress: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: { $eq: ["$$this.status", "in_progress"] },
              },
            },
          },
          completed: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: { $eq: ["$$this.isClosingStatus", true] },
              },
            },
          },
          overdue: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: { $eq: ["$$this.isOverdue", true] },
              },
            },
          },
        },
        // Calculate project progress
        progress: {
          $cond: [
            { $eq: [{ $size: "$allTasks" }, 0] },
            0,
            {
              $multiply: [
                {
                  $divide: [
                    {
                      $size: {
                        $filter: {
                          input: "$allTasks",
                          cond: { $eq: ["$$this.isClosingStatus", true] },
                        },
                      },
                    },
                    { $size: "$allTasks" },
                  ],
                },
                100,
              ],
            },
          ],
        },
        // Calculate total attachment and link counts for project
        fileAttached: {
          $reduce: {
            input: "$allTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", "$$this.fileCount"]
            }
          }
        },
        linksAttached: {
          $reduce: {
            input: "$allTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", "$$this.linkCount"]
            }
          }
        },
        // Add default value for isPinned if missing
        isPinned: { $ifNull: ["$isPinned", false] },
      },
    },

    // Unwind creator
    {
      $unwind: {
        path: "$creator",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Project final board structure
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
        isPinned: 1,
        orderIndex: 1,
        createdAt: 1,
        updatedAt: 1,
        creator: 1,
        tasksByStatus: 1,  // Dynamic status grouping with all statuses
        taskStats: 1,
        progress: {
          $round: ["$progress", 1], // Round to 1 decimal place
        },
        fileAttached: 1,
        linksAttached: 1,
      },
    },
  ];
};

/**
 * Get non-project tasks (Open category) for a channel
 * @param {string} channelId - Channel ID
 * @returns {Array} Aggregation pipeline
 */
exports.getOpenTasksQuery = (channelId) => {
  return [
    // Match tasks by channelId with no projectId
    {
      $match: {
        channelId: Types.ObjectId.createFromHexString(channelId),
        projectId: null,
        isActive: true,
      },
    },

    // Lookup tab to get column definitions
    {
      $lookup: {
        from: "channeltabs",
        localField: "tabId",
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

    // Lookup column definitions for this tab
    {
      $lookup: {
        from: "projectstatuscolumns",
        localField: "tabId",
        foreignField: "tabId",
        as: "columnDefinitions",
        pipeline: [
          {
            $match: {
              isActive: true,
            },
          },
          {
            $project: {
              _id: 1,
              columnKey: 1,
              columnName: 1,
              columnType: 1,
              dropdownOptions: 1,
              order: 1,
            },
          },
          {
            $sort: {
              order: 1,
            },
          },
        ],
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

    // Enrich with columnValues (similar to project tasks)
    {
      $addFields: {
        columnValues: {
          $map: {
            input: "$columnDefinitions",
            as: "colDef",
            in: {
              _id: "$$colDef._id",
              key: "$$colDef.columnKey",
              value: {
                $ifNull: [
                  { $getField: { field: "$$colDef.columnKey", input: { $ifNull: ["$statusColumnValues", {}] } } },
                  null
                ]
              },
              type: "$$colDef.columnType",
              columnName: "$$colDef.columnName",
              dropdownOptions: { $ifNull: ["$$colDef.dropdownOptions", []] }
            }
          }
        },
        // Add file and link counts
        fileCount: { $size: { $ifNull: ["$attachments", []] } },
        linkCount: { $size: { $ifNull: ["$links", []] } },
      },
    },

    // Project task fields
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        channelId: 1,
        status: 1,
        priority: 1,
        dueDate: 1,
        strokeColor: 1,
        isActive: 1,
        orderIndex: 1,
        version: { $ifNull: ["$version", 0] },
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
            },
          },
        },
        createdBy: {
          _id: "$taskCreator._id",
          name: "$taskCreator.name",
          email: "$taskCreator.email",
        },
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
        // Include column data and counts
        columnValues: 1,
        tags: 1,
        fileCount: 1,
        linkCount: 1,
      },
    },

  ];
};

/**
 * Get detailed projects of a tab with tasks (list view)
 * @param {string} channelId - Channel ID
 * @param {string} tabId - Tab ID
 * @param {string} search - Optional search term for project name
 * @returns {Array} Aggregation pipeline
 */
exports.getProjectsListQuery = (channelId, tabId, search = null, { channelDoc, tabDoc, companyName } = {}) => {
  const pipeline = [
    // Match projects by channelId and tabId
    {
      $match: {
        channelId: Types.ObjectId.createFromHexString(channelId),
        tabId: Types.ObjectId.createFromHexString(tabId),
        status: "active", // Only active projects
      },
    },
  ];

  pipeline.push(

    // Lookup project statuses for dynamic status grouping
    {
      $lookup: {
        from: "tabtaskstatuses",
        localField: "_id",
        foreignField: "projectId",
        as: "projectStatuses",
        pipeline: [
          { $match: { isActive: true } },
          { $sort: { order: 1 } },
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
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
            },
          },
        ],
      },
    },

    // Lookup column definitions for this tab
    {
      $lookup: {
        from: "projectstatuscolumns",
        localField: "tabId",
        foreignField: "tabId",
        as: "columnDefinitions",
        pipeline: [
          {
            $match: {
              isActive: true,
            },
          },
          {
            $project: {
              _id: 1,
              columnKey: 1,
              columnName: 1,
              columnType: 1,
              dropdownOptions: 1,
              order: 1,
            },
          },
          {
            $sort: {
              order: 1,
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
              // Add search condition for task title if provided
              ...(search && search.trim() ? { title: { $regex: search.trim(), $options: "i" } } : {}),
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
                    title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
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
                    title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
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
          // Add computed fields including attachment counts
          {
            $addFields: {
              // Add attachment and link counts
              fileCount: { $size: { $ifNull: ["$attachments", []] } },
              linkCount: { $size: { $ifNull: ["$links", []] } },
              // Computed fields for UI
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
                    profileImage: "$$assignee.profileImage",
                  },
                },
              },
              // Task creator - only essential details
              createdBy: {
                _id: "$taskCreator._id",
                name: "$taskCreator.name",
                email: "$taskCreator.email",
                profileImage: "$taskCreator.profileImage",
              },
              // Include computed fields
              isOverdue: 1,
              tags: 1,
              fileCount: 1,
              linkCount: 1,
              // Store statusColumnValues for later enrichment
              statusColumnValues: 1,
            },
          },
        ],
      },
    },

    // Filter out projects with no matching tasks (when search is active)
    ...(search && search.trim() ? [{
      $match: {
        "allTasks.0": { $exists: true } // Only projects with at least one task
      }
    }] : []),

    // Dynamic status grouping for custom statuses (with fallback to default statuses)
    {
      $addFields: {
        // Use projectStatuses if available, otherwise use default system statuses
        effectiveStatuses: {
          $cond: {
            if: { $gt: [{ $size: "$projectStatuses" }, 0] },
            then: "$projectStatuses",
            else: [
              { _id: null, statusKey: "todo", statusName: "To Do", color: "#6B7280", order: 1, isSystem: true, isCompletedStatus: false },
              { _id: null, statusKey: "in_progress", statusName: "In Progress", color: "#3B82F6", order: 2, isSystem: true, isCompletedStatus: false },
              { _id: null, statusKey: "completed", statusName: "Completed", color: "#22C55E", order: 3, isSystem: true, isCompletedStatus: true },
            ],
          },
        },
      },
    },
    {
      $addFields: {
        tasksByStatus: {
          $map: {
            input: "$effectiveStatuses",
            as: "status",
            in: {
              _id: "$$status._id",
              statusKey: "$$status.statusKey",
              statusName: "$$status.statusName",
              color: "$$status.color",
              order: "$$status.order",
              isSystem: "$$status.isSystem",
              tasks: {
                $filter: {
                  input: "$allTasks",
                  cond: { $eq: ["$$this.status", "$$status.statusKey"] },
                },
              },
            },
          },
        },
      },
    },

    // Enrich task column data within tasksByStatus
    {
      $addFields: {
        tasksByStatus: {
          $map: {
            input: "$tasksByStatus",
            as: "statusGroup",
            in: {
              _id: "$$statusGroup._id",
              statusKey: "$$statusGroup.statusKey",
              statusName: "$$statusGroup.statusName",
              color: "$$statusGroup.color",
              order: "$$statusGroup.order",
              isSystem: "$$statusGroup.isSystem",
              tasks: {
                $map: {
                  input: "$$statusGroup.tasks",
                  as: "task",
                  in: {
                    $mergeObjects: [
                      "$$task",
                      {
                        columnValues: {
                          $map: {
                            input: "$columnDefinitions",
                            as: "colDef",
                            in: {
                              _id: "$$colDef._id",
                              key: "$$colDef.columnKey",
                              value: {
                                $ifNull: [
                                  { $getField: { field: "$$colDef.columnKey", input: { $ifNull: ["$$task.statusColumnValues", {}] } } },
                                  null
                                ]
                              },
                              type: "$$colDef.columnType",
                              columnName: "$$colDef.columnName",
                              dropdownOptions: { $ifNull: ["$$colDef.dropdownOptions", []] }
                            }
                          }
                        },
                        statusColumnValues: "$$REMOVE"
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      }
    },

    // Calculate project statistics
    {
      $addFields: {
        taskStats: {
          total: { $size: "$allTasks" },
          todo: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: { $eq: ["$$this.status", "todo"] },
              },
            },
          },
          inProgress: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: { $eq: ["$$this.status", "in_progress"] },
              },
            },
          },
          completed: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: { $eq: ["$$this.isClosingStatus", true] },
              },
            },
          },
          overdue: {
            $size: {
              $filter: {
                input: "$allTasks",
                cond: {
                  $and: [
                    { $ne: ["$$this.dueDate", null] },
                    { $lt: ["$$this.dueDate", new Date()] },
                    { $ne: ["$$this.isClosingStatus", true] },
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
        // Calculate total attachment and link counts for project
        fileAttached: {
          $reduce: {
            input: "$allTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", "$$this.fileCount"]
            }
          }
        },
        linksAttached: {
          $reduce: {
            input: "$allTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", "$$this.linkCount"]
            }
          }
        },
        // Add default value for isPinned if missing
        isPinned: { $ifNull: ["$isPinned", false] },
        // Collect all unique assignees from all tasks (combines assignees from todo, in_progress, and completed tasks)
        assignedTo: {
          $reduce: {
            input: "$allTasks",
            initialValue: [],
            in: {
              $setUnion: ["$$value", { $ifNull: ["$$this.assignees", []] }]
            }
          }
        },
      },
    },

  );

  pipeline.push(
    // Unwind creator to single object
    {
      $unwind: {
        path: "$creator",
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
        isPinned: 1,
        orderIndex: 1,
        createdAt: 1,
        updatedAt: 1,
        creator: 1,
        // Injected from pre-fetched docs — avoids redundant DB lookups per project
        channel: { $literal: { _id: channelDoc?._id, channelName: channelDoc?.channelName } },
        tab: { $literal: { _id: tabDoc?._id, tabName: tabDoc?.tabName } },
        tasksByStatus: 1,
        taskStats: 1,
        assignedTo: 1,
        progress: {
          $round: ["$progress", 1],
        },
        fileAttached: 1,
        linksAttached: 1,
        contextPath: { $concat: [companyName || "Unknown Company", "/", "$name"] },
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
                  1000 * 60 * 60 * 24,
                ],
              },
            },
            else: null,
          },
        },
        ...(search && search.trim() ? { searchScore: 1 } : {}),
      },
    }
  );

  return pipeline;
};

/**
 * Get single project in list view format with all tasks organized by status
 * @param {string} projectId - Project ID
 * @returns {Array} Aggregation pipeline
 */
exports.getSingleProjectListQuery = (projectId) => {
  return [
    // Match the specific project
    {
      $match: {
        _id: Types.ObjectId.createFromHexString(projectId),
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
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
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

    // Lookup column definitions for this tab
    {
      $lookup: {
        from: "projectstatuscolumns",
        localField: "tabId",
        foreignField: "tabId",
        as: "columnDefinitions",
        pipeline: [
          {
            $match: {
              isActive: true,
            },
          },
          {
            $project: {
              _id: 1,
              columnKey: 1,
              columnName: 1,
              columnType: 1,
              dropdownOptions: 1,
              order: 1,
            },
          },
          {
            $sort: {
              order: 1,
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
              // Add search condition for task title if provided
              ...(search && search.trim() ? { title: { $regex: search.trim(), $options: "i" } } : {}),
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
                    title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
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
                    title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1,
              profileImage: { $ifNull: ["$image", null] },
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
          // Add computed fields including attachment counts
          {
            $addFields: {
              // Add attachment and link counts
              fileCount: { $size: { $ifNull: ["$attachments", []] } },
              linkCount: { $size: { $ifNull: ["$links", []] } },
              // Computed fields for UI
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
                    profileImage: "$$assignee.profileImage",
                  },
                },
              },
              // Task creator - only essential details
              createdBy: {
                _id: "$taskCreator._id",
                name: "$taskCreator.name",
                email: "$taskCreator.email",
                profileImage: "$taskCreator.profileImage",
              },
              // Include computed fields
              isOverdue: 1,
              tags: 1,
              fileCount: 1,
              linkCount: 1,
              // Store statusColumnValues for later enrichment
              statusColumnValues: 1,
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
            cond: { $eq: ["$$this.isClosingStatus", true] },
          },
        },
      },
    },

    // Enrich task column data with type and dropdown options
    {
      $addFields: {
        todoTasks: {
          $map: {
            input: "$todoTasks",
            as: "task",
            in: {
              $mergeObjects: [
                "$$task",
                {
                  columnValues: {
                    $map: {
                      input: "$columnDefinitions",
                      as: "colDef",
                      in: {
                        _id: "$$colDef._id",
                        key: "$$colDef.columnKey",
                        value: {
                          $ifNull: [
                            { $getField: { field: "$$colDef.columnKey", input: { $ifNull: ["$$task.statusColumnValues", {}] } } },
                            null
                          ]
                        },
                        type: "$$colDef.columnType",
                        columnName: "$$colDef.columnName",
                        dropdownOptions: { $ifNull: ["$$colDef.dropdownOptions", []] }
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        inProgressTasks: {
          $map: {
            input: "$inProgressTasks",
            as: "task",
            in: {
              $mergeObjects: [
                "$$task",
                {
                  columnValues: {
                    $map: {
                      input: "$columnDefinitions",
                      as: "colDef",
                      in: {
                        _id: "$$colDef._id",
                        key: "$$colDef.columnKey",
                        value: {
                          $ifNull: [
                            { $getField: { field: "$$colDef.columnKey", input: { $ifNull: ["$$task.statusColumnValues", {}] } } },
                            null
                          ]
                        },
                        type: "$$colDef.columnType",
                        columnName: "$$colDef.columnName",
                        dropdownOptions: { $ifNull: ["$$colDef.dropdownOptions", []] }
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        completedTasks: {
          $map: {
            input: "$completedTasks",
            as: "task",
            in: {
              $mergeObjects: [
                "$$task",
                {
                  columnValues: {
                    $map: {
                      input: "$columnDefinitions",
                      as: "colDef",
                      in: {
                        _id: "$$colDef._id",
                        key: "$$colDef.columnKey",
                        value: {
                          $ifNull: [
                            { $getField: { field: "$$colDef.columnKey", input: { $ifNull: ["$$task.statusColumnValues", {}] } } },
                            null
                          ]
                        },
                        type: "$$colDef.columnType",
                        columnName: "$$colDef.columnName",
                        dropdownOptions: { $ifNull: ["$$colDef.dropdownOptions", []] }
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        allTasks: {
          $map: {
            input: "$allTasks",
            as: "task",
            in: {
              $mergeObjects: [
                "$$task",
                {
                  columnValues: {
                    $map: {
                      input: "$columnDefinitions",
                      as: "colDef",
                      in: {
                        _id: "$$colDef._id",
                        key: "$$colDef.columnKey",
                        value: {
                          $ifNull: [
                            { $getField: { field: "$$colDef.columnKey", input: { $ifNull: ["$$task.statusColumnValues", {}] } } },
                            null
                          ]
                        },
                        type: "$$colDef.columnType",
                        columnName: "$$colDef.columnName",
                        dropdownOptions: { $ifNull: ["$$colDef.dropdownOptions", []] }
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      }
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
                    { $ne: ["$$this.isClosingStatus", true] },
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
        // Calculate total attachment and link counts for project
        fileAttached: {
          $reduce: {
            input: "$allTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", "$$this.fileCount"]
            }
          }
        },
        linksAttached: {
          $reduce: {
            input: "$allTasks",
            initialValue: 0,
            in: {
              $add: ["$$value", "$$this.linkCount"]
            }
          }
        },
        // Add default value for isPinned if missing
        isPinned: { $ifNull: ["$isPinned", false] },
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

    // Final project structure (same as list view)
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
        isPinned: 1,
        orderIndex: 1,
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
        fileAttached: 1,
        linksAttached: 1,
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
  ];
};
