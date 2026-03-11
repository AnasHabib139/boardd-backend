"use strict";

const { Types } = require("mongoose");

/**
 * Aggregation pipeline to search tasks by name within a channel.
 * Used by the connection dropdown to find tasks to connect.
 */
exports.getSearchableTasksQuery = (
  channelId,
  searchTerm,
  excludeTaskId,
  limit = 20
) => {
  const channelObjectId = Types.ObjectId.createFromHexString(channelId);

  const matchStage = {
    channelId: channelObjectId,
    isActive: true,
  };

  if (searchTerm) {
    matchStage.title = { $regex: searchTerm, $options: "i" };
  }

  if (excludeTaskId) {
    matchStage._id = {
      $ne: Types.ObjectId.createFromHexString(excludeTaskId),
    };
  }

  return [
    { $match: matchStage },
    {
      $lookup: {
        from: "tabtaskstatuses",
        let: { projId: "$projectId", sKey: "$status" },
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
        title: 1,
        status: { $ifNull: ["$statusInfo.statusName", "$status"] },
        statusColor: { $ifNull: ["$statusInfo.color", null] },
        priority: 1,
      },
    },
    { $sort: { title: 1 } },
    { $limit: limit },
  ];
};

/**
 * Aggregation pipeline to get all connections for a task (bidirectional).
 * Resolves the "other" task with title, status, priority, project name, and channel name.
 */
exports.getTaskConnectionsQuery = (taskId) => {
  const taskObjectId = Types.ObjectId.createFromHexString(taskId);

  return [
    // Match connections where this task is either source or target
    {
      $match: {
        $or: [{ sourceTaskId: taskObjectId }, { targetTaskId: taskObjectId }],
      },
    },
    // Determine the connected task ID (the "other" task)
    {
      $addFields: {
        connectedTaskId: {
          $cond: {
            if: { $eq: ["$sourceTaskId", taskObjectId] },
            then: "$targetTaskId",
            else: "$sourceTaskId",
          },
        },
      },
    },
    // Lookup the connected task (only active tasks)
    {
      $lookup: {
        from: "tasks",
        let: { connectedId: "$connectedTaskId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$connectedId"] },
              isActive: true,
            },
          },
          {
            $project: {
              _id: 1,
              title: 1,
              status: 1,
              priority: 1,
              projectId: 1,
              channelId: 1,
            },
          },
        ],
        as: "connectedTask",
      },
    },
    // Unwind — drops connections to deleted/archived tasks
    {
      $unwind: "$connectedTask",
    },
    // Lookup status info from tabtaskstatuses
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
    // Lookup project for project name
    {
      $lookup: {
        from: "projects",
        localField: "connectedTask.projectId",
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
    // Lookup channel for channel name
    {
      $lookup: {
        from: "channels",
        localField: "connectedTask.channelId",
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
    // Lookup creator user
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    {
      $unwind: {
        path: "$creator",
        preserveNullAndEmptyArrays: true,
      },
    },
    // Final projection
    {
      $project: {
        _id: 1,
        connectedTask: {
          _id: "$connectedTask._id",
          title: "$connectedTask.title",
          status: { $ifNull: ["$statusInfo.statusName", "$connectedTask.status"] },
          statusColor: { $ifNull: ["$statusInfo.color", null] },
          priority: "$connectedTask.priority",
          projectName: { $ifNull: ["$project.name", null] },
          channelName: { $ifNull: ["$channel.channelName", null] },
        },
        createdBy: {
          _id: "$creator._id",
          name: "$creator.name",
          email: "$creator.email",
        },
        createdAt: 1,
      },
    },
    // Sort by most recent first
    {
      $sort: { createdAt: -1 },
    },
  ];
};
