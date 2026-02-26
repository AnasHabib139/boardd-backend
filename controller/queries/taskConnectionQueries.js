"use strict";

const { Types } = require("mongoose");

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
          status: "$connectedTask.status",
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
