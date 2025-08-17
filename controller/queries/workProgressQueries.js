const { Types } = require("mongoose");
const {
  CONTRIBUTION_LEVELS,
  CONTRIBUTION_CATEGORIES,
  CONTRIBUTION_TYPES,
  ACTION_TYPE,
} = require("../../utils/constants");

/**
 * Calculate contribution level based on daily count
 * @param {number} count - Daily contribution count
 * @returns {number} Contribution level (0-4)
 */
const calculateContributionLevel = (count) => {
  if (count === 0) return CONTRIBUTION_LEVELS.NONE.level;
  if (count <= CONTRIBUTION_LEVELS.LIGHT.max)
    return CONTRIBUTION_LEVELS.LIGHT.level;
  if (count <= CONTRIBUTION_LEVELS.MEDIUM.max)
    return CONTRIBUTION_LEVELS.MEDIUM.level;
  if (count <= CONTRIBUTION_LEVELS.HIGH.max)
    return CONTRIBUTION_LEVELS.HIGH.level;
  return CONTRIBUTION_LEVELS.INTENSE.level;
};

/**
 * Get contributions data for work progress graph
 * @param {string} channelId - Channel ID
 * @param {Date} startDate - Start date for the period
 * @param {Date} endDate - End date for the period
 * @returns {Array} Aggregation pipeline
 */
exports.getContributionsQuery = (channelId, startDate, endDate) => {
  return [
    // Match activities in the date range first
    {
      $match: {
        timestamp: {
          $gte: startDate,
          $lte: endDate,
        },
      },
    },

    // Add fields to differentiate activity types
    {
      $addFields: {
        isTaskActivity: { $ne: ["$projectId", null] },
        isClientActivity: { $ne: ["$tabId", null] },
      },
    },

    // Lookup project for task activities
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
              channelId: 1,
            },
          },
        ],
      },
    },

    // Lookup tab for client activities
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
              channelId: 1,
            },
          },
        ],
      },
    },

    // Unwind project and tab (preserve null values)
    {
      $unwind: {
        path: "$project",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$tab",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Match activities from the specific channel (from either projects or tabs)
    {
      $match: {
        $or: [
          {
            "project.channelId": Types.ObjectId.createFromHexString(channelId),
          },
          { "tab.channelId": Types.ObjectId.createFromHexString(channelId) },
        ],
      },
    },

    // Add computed field to detect task completion
    {
      $addFields: {
        isTaskCompletion: {
          $and: [
            { $eq: ["$actionType", ACTION_TYPE.UPDATE_TASK] },
            { $eq: ["$field", "status"] },
            { $eq: ["$newValue", "completed"] },
            { $ne: ["$previousValue", "completed"] }, // Only count new completions
          ],
        },
      },
    },

    // Filter activities we want to track
    {
      $match: {
        $or: [
          // Company progress activities (only task completion)
          { isTaskCompletion: true },

          // Client progress activities
          { actionType: ACTION_TYPE.CREATE_CLIENT },
          { actionType: ACTION_TYPE.ADD_CLIENT_PERSONAL_DETAILS },
          { actionType: ACTION_TYPE.UPDATE_CLIENT_PERSONAL_DETAILS },
          { actionType: ACTION_TYPE.DELETE_CLIENT_PERSONAL_DETAILS },
          { actionType: ACTION_TYPE.ADD_CLIENT_ATTACHMENT },
          { actionType: ACTION_TYPE.DELETE_CLIENT_ATTACHMENT },
          { actionType: ACTION_TYPE.ADD_CLIENT_PROJECT },
          { actionType: ACTION_TYPE.UPDATE_CLIENT_PROJECT },
          { actionType: ACTION_TYPE.DELETE_CLIENT_PROJECT },
        ],
      },
    },

    // Add contribution category based on activity type
    {
      $addFields: {
        contributionCategory: {
          $switch: {
            branches: [
              // Client progress activities (check these first)
              {
                case: {
                  $or: [
                    { $eq: ["$actionType", ACTION_TYPE.CREATE_CLIENT] },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.ADD_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.UPDATE_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.DELETE_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    { $eq: ["$actionType", ACTION_TYPE.ADD_CLIENT_ATTACHMENT] },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.DELETE_CLIENT_ATTACHMENT,
                      ],
                    },
                    { $eq: ["$actionType", ACTION_TYPE.ADD_CLIENT_PROJECT] },
                    { $eq: ["$actionType", ACTION_TYPE.UPDATE_CLIENT_PROJECT] },
                    { $eq: ["$actionType", ACTION_TYPE.DELETE_CLIENT_PROJECT] },
                  ],
                },
                then: CONTRIBUTION_CATEGORIES.CLIENT_PROGRESS,
              },
              // Company progress activities (only task completion)
              {
                case: {
                  $eq: ["$isTaskCompletion", true],
                },
                then: CONTRIBUTION_CATEGORIES.COMPANY_PROGRESS,
              },
            ],
            default: CONTRIBUTION_CATEGORIES.COMPANY_PROGRESS,
          },
        },
        dateOnly: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$timestamp",
            timezone: "UTC",
          },
        },
      },
    },

    // Group by date and category to count daily contributions
    {
      $group: {
        _id: {
          date: "$dateOnly",
          category: "$contributionCategory",
        },
        count: { $sum: 1 },
        activities: {
          $push: {
            id: "$_id",
            actionType: "$actionType",
            userId: "$userId",
            timestamp: "$timestamp",
            isTaskCompletion: "$isTaskCompletion",
            isClientActivity: "$isClientActivity",
          },
        },
      },
    },

    // Reshape data for easier frontend consumption
    {
      $group: {
        _id: "$_id.date",
        contributions: {
          $push: {
            category: "$_id.category",
            count: "$count",
            level: {
              $switch: {
                branches: [
                  { case: { $eq: ["$count", 0] }, then: 0 },
                  { case: { $lte: ["$count", 2] }, then: 1 },
                  { case: { $lte: ["$count", 5] }, then: 2 },
                  { case: { $lte: ["$count", 10] }, then: 3 },
                ],
                default: 4,
              },
            },
            activities: "$activities",
          },
        },
      },
    },

    // Project final structure with both client and company progress
    {
      $project: {
        _id: 0,
        date: "$_id",
        clientProgress: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$contributions",
                cond: {
                  $eq: [
                    "$$this.category",
                    CONTRIBUTION_CATEGORIES.CLIENT_PROGRESS,
                  ],
                },
              },
            },
            0,
          ],
        },
        companyProgress: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$contributions",
                cond: {
                  $eq: [
                    "$$this.category",
                    CONTRIBUTION_CATEGORIES.COMPANY_PROGRESS,
                  ],
                },
              },
            },
            0,
          ],
        },
      },
    },

    // Add default values for missing categories
    {
      $addFields: {
        clientProgress: {
          $ifNull: [
            "$clientProgress",
            {
              category: CONTRIBUTION_CATEGORIES.CLIENT_PROGRESS,
              count: 0,
              level: 0,
              activities: [],
            },
          ],
        },
        companyProgress: {
          $ifNull: [
            "$companyProgress",
            {
              category: CONTRIBUTION_CATEGORIES.COMPANY_PROGRESS,
              count: 0,
              level: 0,
              activities: [],
            },
          ],
        },
      },
    },

    // Sort by date
    {
      $sort: {
        date: 1,
      },
    },
  ];
};

/**
 * Get activities for work progress activity feed
 * @param {string} channelId - Channel ID
 * @param {Date} startDate - Start date for the period
 * @param {Date} endDate - End date for the period
 * @returns {Array} Aggregation pipeline
 */
exports.getActivitiesQuery = (channelId, startDate, endDate) => {
  return [
    // Match activities in the date range first
    {
      $match: {
        timestamp: {
          $gte: startDate,
          $lte: endDate,
        },
      },
    },

    // Add fields to differentiate activity types
    {
      $addFields: {
        isTaskActivity: { $ne: ["$projectId", null] },
        isClientActivity: { $ne: ["$tabId", null] },
      },
    },

    // Lookup project for task activities
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
              channelId: 1,
            },
          },
        ],
      },
    },

    // Lookup tab for client activities
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
              channelId: 1,
            },
          },
        ],
      },
    },

    // Unwind project and tab (preserve null values)
    {
      $unwind: {
        path: "$project",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$tab",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Match activities from the specific channel (from either projects or tabs)
    {
      $match: {
        $or: [
          {
            "project.channelId": Types.ObjectId.createFromHexString(channelId),
          },
          { "tab.channelId": Types.ObjectId.createFromHexString(channelId) },
        ],
      },
    },

    // Add computed field to detect task completion
    {
      $addFields: {
        isTaskCompletion: {
          $and: [
            { $eq: ["$actionType", ACTION_TYPE.UPDATE_TASK] },
            { $eq: ["$field", "status"] },
            { $eq: ["$newValue", "completed"] },
            { $ne: ["$previousValue", "completed"] }, // Only count new completions
          ],
        },
      },
    },

    // Filter activities we want to track
    {
      $match: {
        $or: [
          // Company progress activities (only task completion)
          { isTaskCompletion: true },

          // Client progress activities
          { actionType: ACTION_TYPE.CREATE_CLIENT },
          { actionType: ACTION_TYPE.ADD_CLIENT_PERSONAL_DETAILS },
          { actionType: ACTION_TYPE.UPDATE_CLIENT_PERSONAL_DETAILS },
          { actionType: ACTION_TYPE.DELETE_CLIENT_PERSONAL_DETAILS },
          { actionType: ACTION_TYPE.ADD_CLIENT_ATTACHMENT },
          { actionType: ACTION_TYPE.DELETE_CLIENT_ATTACHMENT },
          { actionType: ACTION_TYPE.ADD_CLIENT_PROJECT },
          { actionType: ACTION_TYPE.UPDATE_CLIENT_PROJECT },
          { actionType: ACTION_TYPE.DELETE_CLIENT_PROJECT },
        ],
      },
    },

    // Lookup user details
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
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

    // Unwind user array
    {
      $unwind: {
        path: "$user",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Add contribution category and format date
    {
      $addFields: {
        activityCategory: {
          $switch: {
            branches: [
              // Client progress activities (check these first)
              {
                case: {
                  $or: [
                    { $eq: ["$actionType", ACTION_TYPE.CREATE_CLIENT] },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.ADD_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.UPDATE_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.DELETE_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    { $eq: ["$actionType", ACTION_TYPE.ADD_CLIENT_ATTACHMENT] },
                    {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.DELETE_CLIENT_ATTACHMENT,
                      ],
                    },
                    { $eq: ["$actionType", ACTION_TYPE.ADD_CLIENT_PROJECT] },
                    { $eq: ["$actionType", ACTION_TYPE.UPDATE_CLIENT_PROJECT] },
                    { $eq: ["$actionType", ACTION_TYPE.DELETE_CLIENT_PROJECT] },
                  ],
                },
                then: "client_activity",
              },
              // Company progress activities (only task completion)
              {
                case: {
                  $eq: ["$isTaskCompletion", true],
                },
                then: "company_activity",
              },
            ],
            default: "company_activity",
          },
        },
        dateOnly: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$timestamp",
            timezone: "UTC",
          },
        },
      },
    },

    // Project final structure with only required data
    {
      $project: {
        _id: 1,
        date: "$dateOnly",
        activityCategory: 1,
        user: {
          _id: "$user._id",
          name: "$user.name",
          email: "$user.email",
        },
        activityMessage: {
          $cond: {
            if: { $ne: ["$message.forOthers", null] },
            then: "$message.forOthers",
            else: {
              $switch: {
                branches: [
                  // Task-related activities
                  {
                    case: { $eq: ["$isTaskCompletion", true] },
                    then: "Completed a task",
                  },
                  {
                    case: { $eq: ["$actionType", ACTION_TYPE.CREATE_TASK] },
                    then: "Created a new task",
                  },
                  {
                    case: { $eq: ["$actionType", ACTION_TYPE.CREATE_PROJECT] },
                    then: "Created a new project",
                  },
                  {
                    case: { $eq: ["$actionType", ACTION_TYPE.ASSIGN_USER] },
                    then: "Assigned a task",
                  },
                  // Client-related activities
                  {
                    case: { $eq: ["$actionType", ACTION_TYPE.CREATE_CLIENT] },
                    then: "Created new client profile",
                  },
                  {
                    case: {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.ADD_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    then: "Added client personal details",
                  },
                  {
                    case: {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.UPDATE_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    then: "Updated client personal details",
                  },
                  {
                    case: {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.DELETE_CLIENT_PERSONAL_DETAILS,
                      ],
                    },
                    then: "Deleted client personal details",
                  },
                  {
                    case: {
                      $eq: ["$actionType", ACTION_TYPE.ADD_CLIENT_ATTACHMENT],
                    },
                    then: "Uploaded client attachment",
                  },
                  {
                    case: {
                      $eq: [
                        "$actionType",
                        ACTION_TYPE.DELETE_CLIENT_ATTACHMENT,
                      ],
                    },
                    then: "Removed client attachment",
                  },
                  {
                    case: {
                      $eq: ["$actionType", ACTION_TYPE.ADD_CLIENT_PROJECT],
                    },
                    then: "Added client project",
                  },
                  {
                    case: {
                      $eq: ["$actionType", ACTION_TYPE.UPDATE_CLIENT_PROJECT],
                    },
                    then: "Updated client project",
                  },
                  {
                    case: {
                      $eq: ["$actionType", ACTION_TYPE.DELETE_CLIENT_PROJECT],
                    },
                    then: "Deleted client project",
                  },
                ],
                default: "Made an update",
              },
            },
          },
        },
        timestamp: 1,
      },
    },

    // Sort by timestamp (newest first)
    {
      $sort: {
        timestamp: -1,
      },
    },
  ];
};
