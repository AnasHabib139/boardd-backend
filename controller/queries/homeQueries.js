"use strict";

/**
 * Build aggregation pipeline for recently viewed forms (internal helper)
 * @param {Object} options - Query options
 * @param {Object} options.user - User object with _id and companyId
 * @param {number} options.limit - Number of recent items to fetch
 * @returns {Array} MongoDB aggregation pipeline
 */
const buildRecentlyViewedFormsQuery = ({ user, limit = 10 }) => {
  const query = [
    // Start with form views for this user
    {
      $match: {
        userId: user._id,
      },
    },
    // Sort by most recently viewed
    {
      $sort: { lastViewedAt: -1 },
    },
    // Limit to recent views
    {
      $limit: limit,
    },
    // Lookup the actual form
    {
      $lookup: {
        from: "forms",
        localField: "formId",
        foreignField: "_id",
        as: "form",
        pipeline: [{ $match: { isActive: true } }],
      },
    },
    {
      $unwind: "$form",
    },
    // Lookup form creator
    {
      $lookup: {
        from: "users",
        localField: "form.createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    {
      $unwind: "$creator",
    },
    // Filter forms user has access to
    {
      $match: {
        $or: [
          // Folder forms: same company
          {
            "form.isFolder": true,
            "creator.companyId": user.companyId,
          },
          // Tab forms: user is tab member (lookup tab)
          {
            "form.isFolder": false,
          },
        ],
      },
    },
    // For tab forms, check tab membership
    {
      $lookup: {
        from: "channeltabs",
        localField: "form.tabId",
        foreignField: "_id",
        as: "tab",
      },
    },
    {
      $addFields: {
        tab: { $arrayElemAt: ["$tab", 0] },
      },
    },
    // Filter tab forms to only those user has access to
    {
      $match: {
        $or: [
          { "form.isFolder": true },
          {
            "form.isFolder": false,
            "tab.members": user._id,
          },
        ],
      },
    },
    // Lookup channel for tab forms
    {
      $lookup: {
        from: "channels",
        localField: "tab.channelId",
        foreignField: "_id",
        as: "channel",
      },
    },
    {
      $addFields: {
        channel: { $arrayElemAt: ["$channel", 0] },
      },
    },
    // Build context path
    {
      $addFields: {
        contextPath: {
          $cond: {
            if: "$form.isFolder",
            then: {
              $concat: [
                "folder/",
                { $toLower: { $ifNull: ["$form.type", "form"] } }
              ],
            },
            else: {
              $concat: [
                { $ifNull: ["$channel.channelName", "Unknown Channel"] },
                " / ",
                { $ifNull: ["$tab.tabName", "Unknown Tab"] },
              ],
            },
          },
        },
        contextType: {
          $cond: {
            if: "$form.isFolder",
            then: "folder",
            else: "channel",
          },
        },
      },
    },
    // Final projection
    {
      $project: {
        _id: "$form._id",
        title: "$form.title",
        description: "$form.description",
        type: "$form.type",
        lastViewedAt: 1,
        contextPath: 1,
        contextType: 1,
        itemType: { $literal: "form" },
        creator: {
          _id: "$creator._id",
          name: "$creator.name",
          email: "$creator.email",
        },
      },
    },
  ];

  return query;
};

/**
 * Build aggregation pipeline for recently viewed tasks (internal helper)
 * @param {Object} options - Query options
 * @param {Object} options.user - User object with _id and companyId
 * @param {number} options.limit - Number of recent items to fetch
 * @returns {Array} MongoDB aggregation pipeline
 */
const buildRecentlyViewedTasksQuery = ({ user, limit = 10 }) => {
  const query = [
    // Start with task views for this user
    {
      $match: {
        userId: user._id,
      },
    },
    // Sort by most recently viewed
    {
      $sort: { lastViewedAt: -1 },
    },
    // Limit to recent views
    {
      $limit: limit,
    },
    // Lookup the actual task
    {
      $lookup: {
        from: "tasks",
        localField: "taskId",
        foreignField: "_id",
        as: "task",
        pipeline: [{ $match: { isActive: true } }],
      },
    },
    {
      $unwind: "$task",
    },
    // Lookup project for project-based tasks
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
    // Add tabId field conditionally
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
    // Lookup tab
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
    // Add channelId field conditionally  
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
    // Lookup channel
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
    },
    // Filter tasks user has access to (assigned, tab member, or channel member)
    {
      $match: {
        $or: [
          { "task.assignedTo": user._id },
          { "task.createdBy": user._id },
          { "tab.members": user._id },
          { "channel.members": user._id },
        ],
      },
    },
    // Lookup task creator
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
    },
    // Build context path
    {
      $addFields: {
        contextPath: {
          $concat: [
            { $ifNull: ["$channel.channelName", "Unknown Channel"] },
            " / ",
            { $ifNull: ["$tab.tabName", "Unknown Tab"] },
            " / ",
            { $ifNull: ["$project.name", "Open"] },
          ],
        },
        contextType: { $literal: "channel" },
      },
    },
    // Final projection
    {
      $project: {
        _id: "$task._id",
        title: "$task.title",
        description: "$task.description",
        status: "$task.status",
        priority: "$task.priority",
        dueDate: "$task.dueDate",
        lastViewedAt: 1,
        contextPath: 1,
        contextType: 1,
        itemType: { $literal: "task" },
        creator: {
          _id: "$creator._id",
          name: "$creator.name",
          email: "$creator.email",
        },
      },
    },
  ];

  return query;
};

/**
 * Build combined aggregation pipeline for recently viewed items (forms + tasks)
 * @param {Object} options - Query options
 * @param {Object} options.user - User object with _id and companyId
 * @returns {Array} Combined MongoDB aggregation pipeline using $unionWith
 */
exports.buildRecentlyViewedCombinedQuery = ({ user }) => {
  // Start with forms query (no limit since pagination is handled by utility)
  const formsQuery = buildRecentlyViewedFormsQuery({ user, limit: 1000 });
  
  // Create union with tasks
  const combinedQuery = [
    ...formsQuery,
    // Union with tasks
    {
      $unionWith: {
        coll: "taskviews",
        pipeline: buildRecentlyViewedTasksQuery({ user, limit: 1000 }),
      },
    },
    // Sort combined results by lastViewedAt (final sort will be handled by pagination utility)
    {
      $sort: { lastViewedAt: -1 },
    },
  ];

  return combinedQuery;
};