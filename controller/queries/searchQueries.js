"use strict";

const { Types } = require("mongoose");

/**
 * Build tasks search pipeline
 */
const buildTasksSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId,
    assignedTo,
    createdBy,
    status,
    startDate,
    endDate,
    page = 1,
    limit = 10
  } = filters;

  const pipeline = [];

  // Match by company (required for access control)
  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    isActive: true
  };

  // Text search if query provided
  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Lookup to check user has access to the task (via channel membership or assignment)
  pipeline.push({
    $lookup: {
      from: "channels",
      localField: "channelId",
      foreignField: "_id",
      as: "channel"
    }
  });

  pipeline.push({
    $unwind: {
      path: "$channel",
      preserveNullAndEmptyArrays: true
    }
  });

  // Filter by real channel membership (not just same-company channel) or assignment
  const accessFilter = {
    $or: [
      { "channel.members": new Types.ObjectId(userId) },
      { assignedTo: new Types.ObjectId(userId) },
      { createdBy: new Types.ObjectId(userId) }
    ]
  };

  pipeline.push({ $match: accessFilter });

  // Apply additional filters
  const additionalFilters = {};

  if (assignedTo) {
    additionalFilters.assignedTo = new Types.ObjectId(assignedTo);
  }

  if (createdBy) {
    additionalFilters.createdBy = new Types.ObjectId(createdBy);
  }

  if (status) {
    additionalFilters.status = status;
  }

  if (startDate || endDate) {
    additionalFilters.createdAt = {};
    if (startDate) {
      additionalFilters.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      additionalFilters.createdAt.$lte = new Date(endDate);
    }
  }

  if (Object.keys(additionalFilters).length > 0) {
    pipeline.push({ $match: additionalFilters });
  }

  // Add text search score if search query provided
  if (searchQuery) {
    pipeline.push({
      $addFields: {
        searchScore: { $meta: "textScore" }
      }
    });
  }

  // Lookup assigned users
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "assignedTo",
      foreignField: "_id",
      as: "assignedToUsers",
      pipeline: [
        {
          $project: {
            _id: 1,
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            designation: 1
          }
        }
      ]
    }
  });

  // Lookup created by user
  pipeline.push({
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
            image: 1,
            role: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$creator",
      preserveNullAndEmptyArrays: true
    }
  });

  // Lookup project
  pipeline.push({
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
            color: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$project",
      preserveNullAndEmptyArrays: true
    }
  });

  // Lookup status name/color from TabTaskStatus
  pipeline.push({
    $lookup: {
      from: "tabtaskstatuses",
      let: { projectId: "$projectId", statusKey: "$status" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$projectId", "$$projectId"] },
                { $eq: ["$statusKey", "$$statusKey"] },
                { $eq: ["$isActive", true] },
              ],
            },
          },
        },
        { $project: { _id: 0, statusKey: 1, statusName: 1, color: 1 } },
      ],
      as: "statusDetail",
    },
  });

  // Resolve status key to display name; fall back to raw key if not found
  pipeline.push({
    $addFields: {
      status: {
        $ifNull: [{ $arrayElemAt: ["$statusDetail.statusName", 0] }, "$status"],
      },
    },
  });

  // Sort by search relevance or date
  if (searchQuery) {
    pipeline.push({ $sort: { searchScore: -1, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }

  // Project final fields
  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      status: 1,
      priority: 1,
      dueDate: 1,
      tags: 1,
      strokeColor: 1,
      createdAt: 1,
      updatedAt: 1,
      assignedToUsers: 1,
      creator: 1,
      project: 1,
      channel: {
        _id: "$channel._id",
        name: "$channel.name"
      },
      searchScore: 1
    }
  });

  // Pagination
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  return pipeline;
};

/**
 * Build members/users search pipeline
 */
const buildMembersSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    designation,
    page = 1,
    limit = 10
  } = filters;

  const pipeline = [];

  // Match by company and active status
  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    isActive: true
  };

  // Text search if query provided
  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Apply additional filters
  if (designation) {
    pipeline.push({
      $match: {
        designation: { $regex: designation, $options: "i" }
      }
    });
  }

  // Add text search score if search query provided
  if (searchQuery) {
    pipeline.push({
      $addFields: {
        searchScore: { $meta: "textScore" }
      }
    });
  }

  // Sort by search relevance or name
  if (searchQuery) {
    pipeline.push({ $sort: { searchScore: -1, name: 1 } });
  } else {
    pipeline.push({ $sort: { name: 1 } });
  }

  // Project final fields
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      email: 1,
      image: 1,
      coverImage: 1,
      role: 1,
      designation: 1,
      title: 1,
      nickname: 1,
      createdAt: 1,
      searchScore: 1
    }
  });

  // Pagination
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  return pipeline;
};

/**
 * Build count pipeline for tasks
 */
const buildTasksCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId,
    assignedTo,
    createdBy,
    status,
    startDate,
    endDate
  } = filters;

  const pipeline = [];

  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    isActive: true
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Lookup channel for access control
  pipeline.push({
    $lookup: {
      from: "channels",
      localField: "channelId",
      foreignField: "_id",
      as: "channel"
    }
  });

  pipeline.push({
    $unwind: {
      path: "$channel",
      preserveNullAndEmptyArrays: true
    }
  });

  // Access filter — real channel membership (not just same-company channel) or assignment
  const accessFilter = {
    $or: [
      { "channel.members": new Types.ObjectId(userId) },
      { assignedTo: new Types.ObjectId(userId) },
      { createdBy: new Types.ObjectId(userId) }
    ]
  };

  pipeline.push({ $match: accessFilter });

  // Additional filters
  const additionalFilters = {};

  if (assignedTo) {
    additionalFilters.assignedTo = new Types.ObjectId(assignedTo);
  }

  if (createdBy) {
    additionalFilters.createdBy = new Types.ObjectId(createdBy);
  }

  if (status) {
    additionalFilters.status = status;
  }

  if (startDate || endDate) {
    additionalFilters.createdAt = {};
    if (startDate) {
      additionalFilters.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      additionalFilters.createdAt.$lte = new Date(endDate);
    }
  }

  if (Object.keys(additionalFilters).length > 0) {
    pipeline.push({ $match: additionalFilters });
  }

  pipeline.push({ $count: "total" });

  return pipeline;
};

/**
 * Build count pipeline for members
 */
const buildMembersCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    designation
  } = filters;

  const pipeline = [];

  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    isActive: true
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  if (designation) {
    pipeline.push({
      $match: {
        designation: { $regex: designation, $options: "i" }
      }
    });
  }

  pipeline.push({ $count: "total" });

  return pipeline;
};

/**
 * Build chats search pipeline
 */
const buildChatsSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId,
    page = 1,
    limit = 10
  } = filters;

  const pipeline = [];

  // Match by company and exclude deleted messages
  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    deletedAt: null
  };

  // Text search if query provided
  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Lookup conversation to check participant access
  pipeline.push({
    $lookup: {
      from: "chatconversations",
      localField: "conversationId",
      foreignField: "_id",
      as: "conversation"
    }
  });

  pipeline.push({
    $unwind: {
      path: "$conversation",
      preserveNullAndEmptyArrays: false
    }
  });

  // Check user is participant in conversation
  pipeline.push({
    $match: {
      "conversation.participants.userId": new Types.ObjectId(userId)
    }
  });

  // Add text search score if search query provided
  if (searchQuery) {
    pipeline.push({
      $addFields: {
        searchScore: { $meta: "textScore" }
      }
    });
  }

  // Lookup author user
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "authorId",
      foreignField: "_id",
      as: "author",
      pipeline: [
        {
          $project: {
            _id: 1,
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            designation: 1,
            title: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$author",
      preserveNullAndEmptyArrays: true
    }
  });

  // Lookup channel if conversation type is channel
  pipeline.push({
    $lookup: {
      from: "channels",
      localField: "conversation.channelId",
      foreignField: "_id",
      as: "channel",
      pipeline: [
        {
          $project: {
            _id: 1,
            name: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$channel",
      preserveNullAndEmptyArrays: true
    }
  });

  // Sort by search relevance or date
  if (searchQuery) {
    pipeline.push({ $sort: { searchScore: -1, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }

  // Project final fields
  pipeline.push({
    $project: {
      _id: 1,
      conversationId: 1,
      authorId: 1,
      contentText: 1,
      contentDoc: 1,
      attachmentsUrls: 1,
      attachmentsMeta: 1,
      createdAt: 1,
      editedAt: 1,
      author: 1,
      conversation: {
        _id: "$conversation._id",
        type: "$conversation.type",
        channelId: "$conversation.channelId",
        participantIds: "$conversation.participantIds"
      },
      channel: 1,
      searchScore: 1
    }
  });

  // Pagination
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  return pipeline;
};

/**
 * Build count pipeline for chats
 */
const buildChatsCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId
  } = filters;

  const pipeline = [];

  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    deletedAt: null
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Lookup conversation for access control
  pipeline.push({
    $lookup: {
      from: "chatconversations",
      localField: "conversationId",
      foreignField: "_id",
      as: "conversation"
    }
  });

  pipeline.push({
    $unwind: {
      path: "$conversation",
      preserveNullAndEmptyArrays: false
    }
  });

  // Check user is participant
  pipeline.push({
    $match: {
      "conversation.participants.userId": new Types.ObjectId(userId)
    }
  });

  pipeline.push({ $count: "total" });

  return pipeline;
};

/**
 * Build files search pipeline (combines task and chat attachments)
 */
const buildFilesSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId,
    page = 1,
    limit = 10
  } = filters;

  // Pipeline for task attachments
  const taskFilesPipeline = [
    // Match active tasks
    {
      $match: {
        isActive: true,
        attachments: { $exists: true, $ne: [] }
      }
    },
    // Lookup channel for access control
    {
      $lookup: {
        from: "channels",
        localField: "channelId",
        foreignField: "_id",
        as: "channel"
      }
    },
    {
      $unwind: {
        path: "$channel",
        preserveNullAndEmptyArrays: true
      }
    },
    // Access control
    {
      $match: {
        $or: [
          { "channel.members": new Types.ObjectId(userId) },
          { assignedTo: new Types.ObjectId(userId) },
          { createdBy: new Types.ObjectId(userId) }
        ]
      }
    },
    // Unwind attachments
    {
      $unwind: "$attachments"
    },
    // Filter by fileName if search query provided
    ...(searchQuery ? [{
      $match: {
        "attachments.fileName": { $regex: searchQuery, $options: "i" }
      }
    }] : []),
    // Lookup uploader
    {
      $lookup: {
        from: "users",
        localField: "attachments.uploadedBy",
        foreignField: "_id",
        as: "uploader",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              image: 1
            }
          }
        ]
      }
    },
    {
      $unwind: {
        path: "$uploader",
        preserveNullAndEmptyArrays: true
      }
    },
    // Lookup project
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
              name: 1
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
    // Normalize to unified format
    {
      $project: {
        _id: "$attachments._id",
        fileName: "$attachments.fileName",
        fileSize: "$attachments.fileSize",
        mimeType: "$attachments.mimeType",
        url: "$attachments.url",
        uploadedBy: "$uploader",
        uploadedAt: "$attachments.uploadedAt",
        source: "$attachments.source",
        sourceType: { $literal: "task" },
        sourceId: "$_id",
        sourceName: "$title",
        channelId: "$channelId",
        channelName: "$channel.name",
        projectId: "$projectId",
        projectName: "$project.name"
      }
    }
  ];

  // Pipeline for chat attachments
  const chatFilesPipeline = [
    // Match messages with attachments
    {
      $match: {
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
        attachmentsMeta: { $exists: true, $ne: [] }
      }
    },
    // Lookup conversation for access control
    {
      $lookup: {
        from: "chatconversations",
        localField: "conversationId",
        foreignField: "_id",
        as: "conversation"
      }
    },
    {
      $unwind: {
        path: "$conversation",
        preserveNullAndEmptyArrays: false
      }
    },
    // Check user is participant
    {
      $match: {
        "conversation.participants.userId": new Types.ObjectId(userId)
      }
    },
    // Unwind attachments
    {
      $unwind: "$attachmentsMeta"
    },
    // Filter by fileName if search query provided
    ...(searchQuery ? [{
      $match: {
        "attachmentsMeta.fileName": { $regex: searchQuery, $options: "i" }
      }
    }] : []),
    // Lookup author
    {
      $lookup: {
        from: "users",
        localField: "authorId",
        foreignField: "_id",
        as: "author",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              image: 1
            }
          }
        ]
      }
    },
    {
      $unwind: {
        path: "$author",
        preserveNullAndEmptyArrays: true
      }
    },
    // Lookup channel
    {
      $lookup: {
        from: "channels",
        localField: "conversation.channelId",
        foreignField: "_id",
        as: "channel",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1
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
    },
    // Normalize to unified format
    {
      $project: {
        _id: { $toString: "$_id" }, // Use message ID + index as identifier
        fileName: "$attachmentsMeta.fileName",
        fileSize: "$attachmentsMeta.fileSize",
        mimeType: "$attachmentsMeta.mimeType",
        url: "$attachmentsMeta.url",
        uploadedBy: "$author",
        uploadedAt: "$createdAt",
        source: { $literal: "chat" },
        sourceType: { $literal: "chat" },
        sourceId: "$conversationId",
        sourceName: {
          $cond: [
            { $ne: ["$channel", null] },
            "$channel.name",
            "Direct Message"
          ]
        },
        channelId: "$conversation.channelId",
        channelName: "$channel.name",
        projectId: null,
        projectName: null
      }
    }
  ];

  // Start with task files, then union with chat files
  const pipeline = [
    ...taskFilesPipeline,
    {
      $unionWith: {
        coll: "chatmessages",
        pipeline: chatFilesPipeline
      }
    },
    // Sort by upload date
    {
      $sort: { uploadedAt: -1 }
    },
    // Pagination
    {
      $skip: (page - 1) * limit
    },
    {
      $limit: limit
    }
  ];

  return pipeline;
};

/**
 * Build count pipeline for files
 */
const buildFilesCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId
  } = filters;

  // Count task attachments
  const taskFilesCountPipeline = [
    {
      $match: {
        isActive: true,
        attachments: { $exists: true, $ne: [] }
      }
    },
    {
      $lookup: {
        from: "channels",
        localField: "channelId",
        foreignField: "_id",
        as: "channel"
      }
    },
    {
      $unwind: {
        path: "$channel",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $match: {
        $or: [
          { "channel.members": new Types.ObjectId(userId) },
          { assignedTo: new Types.ObjectId(userId) },
          { createdBy: new Types.ObjectId(userId) }
        ]
      }
    },
    {
      $unwind: "$attachments"
    },
    ...(searchQuery ? [{
      $match: {
        "attachments.fileName": { $regex: searchQuery, $options: "i" }
      }
    }] : [])
  ];

  // Count chat attachments
  const chatFilesCountPipeline = [
    {
      $match: {
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
        attachmentsMeta: { $exists: true, $ne: [] }
      }
    },
    {
      $lookup: {
        from: "chatconversations",
        localField: "conversationId",
        foreignField: "_id",
        as: "conversation"
      }
    },
    {
      $unwind: {
        path: "$conversation",
        preserveNullAndEmptyArrays: false
      }
    },
    {
      $match: {
        "conversation.participants.userId": new Types.ObjectId(userId)
      }
    },
    {
      $unwind: "$attachmentsMeta"
    },
    ...(searchQuery ? [{
      $match: {
        "attachmentsMeta.fileName": { $regex: searchQuery, $options: "i" }
      }
    }] : [])
  ];

  // Combine counts using unionWith
  const pipeline = [
    ...taskFilesCountPipeline,
    {
      $unionWith: {
        coll: "chatmessages",
        pipeline: chatFilesCountPipeline
      }
    },
    {
      $count: "total"
    }
  ];

  return pipeline;
};

/**
 * Build folders search pipeline
 */
const buildFoldersSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    page = 1,
    limit = 10
  } = filters;

  const pipeline = [];

  // Match folders only
  const matchStage = {
    isFolder: true,
    isActive: true
  };

  // Text search if query provided
  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Add text search score if search query provided
  if (searchQuery) {
    pipeline.push({
      $addFields: {
        searchScore: { $meta: "textScore" }
      }
    });
  }

  // Lookup creator for company filtering
  pipeline.push({
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
            image: 1,
            companyId: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$creator",
      preserveNullAndEmptyArrays: false
    }
  });

  // Filter by company
  pipeline.push({
    $match: {
      "creator.companyId": new Types.ObjectId(companyId)
    }
  });

  // Sort by search relevance or date
  if (searchQuery) {
    pipeline.push({ $sort: { searchScore: -1, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }

  // Project final fields
  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      type: 1,
      status: 1,
      isPrivate: 1,
      isFolder: 1,
      createdAt: 1,
      updatedAt: 1,
      creator: {
        _id: "$creator._id",
        name: "$creator.name",
        email: "$creator.email",
        image: "$creator.image"
      },
      searchScore: 1
    }
  });

  // Pagination
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  return pipeline;
};

/**
 * Build count pipeline for folders
 */
const buildFoldersCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId
  } = filters;

  const pipeline = [];

  const matchStage = {
    isFolder: true,
    isActive: true
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Lookup creator for company filtering
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "createdBy",
      foreignField: "_id",
      as: "creator",
      pipeline: [
        {
          $project: {
            companyId: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$creator",
      preserveNullAndEmptyArrays: false
    }
  });

  // Filter by company
  pipeline.push({
    $match: {
      "creator.companyId": new Types.ObjectId(companyId)
    }
  });

  pipeline.push({ $count: "total" });

  return pipeline;
};

/**
 * Build documents search pipeline
 */
const buildDocumentsSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    page = 1,
    limit = 10
  } = filters;

  const pipeline = [];

  // Match documents only (type: "document" AND isFolder: false)
  const matchStage = {
    type: "document",
    isFolder: false,
    isActive: true
  };

  // Text search if query provided
  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Add text search score if search query provided
  if (searchQuery) {
    pipeline.push({
      $addFields: {
        searchScore: { $meta: "textScore" }
      }
    });
  }

  // Lookup creator for company filtering
  pipeline.push({
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
            image: 1,
            companyId: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$creator",
      preserveNullAndEmptyArrays: false
    }
  });

  // Filter by company
  pipeline.push({
    $match: {
      "creator.companyId": new Types.ObjectId(companyId)
    }
  });

  // Sort by search relevance or date
  if (searchQuery) {
    pipeline.push({ $sort: { searchScore: -1, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }

  // Project final fields
  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      type: 1,
      status: 1,
      isPrivate: 1,
      isFolder: 1,
      createdAt: 1,
      updatedAt: 1,
      creator: {
        _id: "$creator._id",
        name: "$creator.name",
        email: "$creator.email",
        image: "$creator.image"
      },
      searchScore: 1
    }
  });

  // Pagination
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  return pipeline;
};

/**
 * Build count pipeline for documents
 */
const buildDocumentsCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId
  } = filters;

  const pipeline = [];

  const matchStage = {
    type: "document",
    isFolder: false,
    isActive: true
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Lookup creator for company filtering
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "createdBy",
      foreignField: "_id",
      as: "creator",
      pipeline: [
        {
          $project: {
            companyId: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$creator",
      preserveNullAndEmptyArrays: false
    }
  });

  // Filter by company
  pipeline.push({
    $match: {
      "creator.companyId": new Types.ObjectId(companyId)
    }
  });

  pipeline.push({ $count: "total" });

  return pipeline;
};

/**
 * Build templates search pipeline
 */
const buildTemplatesSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    page = 1,
    limit = 10
  } = filters;

  const pipeline = [];

  // Match templates only (type: "template" AND isFolder: false)
  const matchStage = {
    type: "template",
    isFolder: false,
    isActive: true
  };

  // Text search if query provided
  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Add text search score if search query provided
  if (searchQuery) {
    pipeline.push({
      $addFields: {
        searchScore: { $meta: "textScore" }
      }
    });
  }

  // Lookup creator for company filtering
  pipeline.push({
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
            image: 1,
            companyId: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$creator",
      preserveNullAndEmptyArrays: false
    }
  });

  // Filter by company
  pipeline.push({
    $match: {
      "creator.companyId": new Types.ObjectId(companyId)
    }
  });

  // Sort by search relevance or date
  if (searchQuery) {
    pipeline.push({ $sort: { searchScore: -1, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }

  // Project final fields
  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      type: 1,
      status: 1,
      isPrivate: 1,
      isFolder: 1,
      createdAt: 1,
      updatedAt: 1,
      creator: {
        _id: "$creator._id",
        name: "$creator.name",
        email: "$creator.email",
        image: "$creator.image"
      },
      searchScore: 1
    }
  });

  // Pagination
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  return pipeline;
};

/**
 * Build count pipeline for templates
 */
const buildTemplatesCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId
  } = filters;

  const pipeline = [];

  const matchStage = {
    type: "template",
    isFolder: false,
    isActive: true
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Lookup creator for company filtering
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "createdBy",
      foreignField: "_id",
      as: "creator",
      pipeline: [
        {
          $project: {
            companyId: 1
          }
        }
      ]
    }
  });

  pipeline.push({
    $unwind: {
      path: "$creator",
      preserveNullAndEmptyArrays: false
    }
  });

  // Filter by company
  pipeline.push({
    $match: {
      "creator.companyId": new Types.ObjectId(companyId)
    }
  });

  pipeline.push({ $count: "total" });

  return pipeline;
};

/**
 * Build subtasks search pipeline
 */
const buildSubtasksSearchPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId,
    assignedTo,
    createdBy,
    status,
    startDate,
    endDate,
    page = 1,
    limit = 10,
  } = filters;

  const pipeline = [];

  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    isActive: true,
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  // Apply additional filters
  const additionalFilters = {};

  if (assignedTo) {
    additionalFilters.assignedTo = new Types.ObjectId(assignedTo);
  }

  if (createdBy) {
    additionalFilters.createdBy = new Types.ObjectId(createdBy);
  }

  if (status) {
    additionalFilters.status = status;
  }

  if (startDate || endDate) {
    additionalFilters.createdAt = {};
    if (startDate) additionalFilters.createdAt.$gte = new Date(startDate);
    if (endDate) additionalFilters.createdAt.$lte = new Date(endDate);
  }

  if (Object.keys(additionalFilters).length > 0) {
    pipeline.push({ $match: additionalFilters });
  }

  if (searchQuery) {
    pipeline.push({ $addFields: { searchScore: { $meta: "textScore" } } });
  }

  // Lookup parent task
  pipeline.push({
    $lookup: {
      from: "tasks",
      localField: "taskId",
      foreignField: "_id",
      as: "parentTask",
      pipeline: [
        {
          $project: {
            _id: 1,
            title: 1,
            status: 1,
            priority: 1,
            dueDate: 1,
            channelId: 1,
            projectId: 1,
          },
        },
      ],
    },
  });

  pipeline.push({
    $unwind: { path: "$parentTask", preserveNullAndEmptyArrays: true },
  });

  // Lookup project
  pipeline.push({
    $lookup: {
      from: "projects",
      localField: "projectId",
      foreignField: "_id",
      as: "project",
      pipeline: [
        { $project: { _id: 1, name: 1, color: 1, description: 1, channelId: 1 } },
      ],
    },
  });

  pipeline.push({
    $unwind: { path: "$project", preserveNullAndEmptyArrays: true },
  });

  // Resolve the channel: open tasks carry channelId directly, project tasks
  // resolve it via project.channelId (Task.channelId is null once a task
  // belongs to a project — see models/taskModel.js "Remove channelId when
  // moving to project")
  pipeline.push({
    $addFields: {
      effectiveChannelId: {
        $ifNull: ["$parentTask.channelId", "$project.channelId"],
      },
    },
  });

  pipeline.push({
    $lookup: {
      from: "channels",
      localField: "effectiveChannelId",
      foreignField: "_id",
      as: "channel",
    },
  });

  pipeline.push({
    $unwind: { path: "$channel", preserveNullAndEmptyArrays: true },
  });

  // Access filter — real channel membership, or the subtask's own assignee/creator
  pipeline.push({
    $match: {
      $or: [
        { "channel.members": new Types.ObjectId(userId) },
        { assignedTo: new Types.ObjectId(userId) },
        { createdBy: new Types.ObjectId(userId) },
      ],
    },
  });

  // Lookup status detail from TabTaskStatus
  pipeline.push({
    $lookup: {
      from: "tabtaskstatuses",
      let: { projectId: "$projectId", statusKey: "$status" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$projectId", "$$projectId"] },
                { $eq: ["$statusKey", "$$statusKey"] },
                { $eq: ["$isActive", true] },
              ],
            },
          },
        },
        { $project: { _id: 0, statusKey: 1, statusName: 1, color: 1 } },
      ],
      as: "statusDetail",
    },
  });

  // Resolve status key to display name; fall back to raw key if not found
  pipeline.push({
    $addFields: {
      status: {
        $ifNull: [{ $arrayElemAt: ["$statusDetail.statusName", 0] }, "$status"],
      },
    },
  });

  // Lookup assigned users
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "assignedTo",
      foreignField: "_id",
      as: "assignedToUsers",
      pipeline: [
        { $project: { _id: 1, name: 1, email: 1, image: 1, role: 1, designation: 1 } },
      ],
    },
  });

  // Lookup creator
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "createdBy",
      foreignField: "_id",
      as: "creator",
      pipeline: [
        { $project: { _id: 1, name: 1, email: 1, image: 1, role: 1 } },
      ],
    },
  });

  pipeline.push({
    $unwind: { path: "$creator", preserveNullAndEmptyArrays: true },
  });

  // Sort
  if (searchQuery) {
    pipeline.push({ $sort: { searchScore: -1, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { createdAt: -1 } });
  }

  // Project final fields
  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      status: 1,
      priority: 1,
      dueDate: 1,
      tags: 1,
      strokeColor: 1,
      createdAt: 1,
      updatedAt: 1,
      assignedToUsers: 1,
      creator: 1,
      parentTask: 1,
      project: 1,
      searchScore: 1,
    },
  });

  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  return pipeline;
};

/**
 * Build count pipeline for subtasks
 */
const buildSubtasksCountPipeline = (filters) => {
  const {
    searchQuery,
    companyId,
    userId,
    assignedTo,
    createdBy,
    status,
    startDate,
    endDate,
  } = filters;

  const pipeline = [];

  const matchStage = {
    companyId: new Types.ObjectId(companyId),
    isActive: true,
  };

  if (searchQuery) {
    matchStage.$text = { $search: searchQuery };
  }

  pipeline.push({ $match: matchStage });

  const additionalFilters = {};

  if (assignedTo) additionalFilters.assignedTo = new Types.ObjectId(assignedTo);
  if (createdBy) additionalFilters.createdBy = new Types.ObjectId(createdBy);
  if (status) additionalFilters.status = status;

  if (startDate || endDate) {
    additionalFilters.createdAt = {};
    if (startDate) additionalFilters.createdAt.$gte = new Date(startDate);
    if (endDate) additionalFilters.createdAt.$lte = new Date(endDate);
  }

  if (Object.keys(additionalFilters).length > 0) {
    pipeline.push({ $match: additionalFilters });
  }

  // Lookup parent task + project to resolve the channel, same as the search pipeline
  pipeline.push({
    $lookup: {
      from: "tasks",
      localField: "taskId",
      foreignField: "_id",
      as: "parentTask",
      pipeline: [{ $project: { channelId: 1 } }],
    },
  });

  pipeline.push({
    $unwind: { path: "$parentTask", preserveNullAndEmptyArrays: true },
  });

  pipeline.push({
    $lookup: {
      from: "projects",
      localField: "projectId",
      foreignField: "_id",
      as: "project",
      pipeline: [{ $project: { channelId: 1 } }],
    },
  });

  pipeline.push({
    $unwind: { path: "$project", preserveNullAndEmptyArrays: true },
  });

  pipeline.push({
    $addFields: {
      effectiveChannelId: {
        $ifNull: ["$parentTask.channelId", "$project.channelId"],
      },
    },
  });

  pipeline.push({
    $lookup: {
      from: "channels",
      localField: "effectiveChannelId",
      foreignField: "_id",
      as: "channel",
    },
  });

  pipeline.push({
    $unwind: { path: "$channel", preserveNullAndEmptyArrays: true },
  });

  // Access filter — real channel membership, or the subtask's own assignee/creator
  pipeline.push({
    $match: {
      $or: [
        { "channel.members": new Types.ObjectId(userId) },
        { assignedTo: new Types.ObjectId(userId) },
        { createdBy: new Types.ObjectId(userId) },
      ],
    },
  });

  pipeline.push({ $count: "total" });

  return pipeline;
};

module.exports = {
  buildTasksSearchPipeline,
  buildMembersSearchPipeline,
  buildTasksCountPipeline,
  buildMembersCountPipeline,
  buildChatsSearchPipeline,
  buildChatsCountPipeline,
  buildFilesSearchPipeline,
  buildFilesCountPipeline,
  buildFoldersSearchPipeline,
  buildFoldersCountPipeline,
  buildDocumentsSearchPipeline,
  buildDocumentsCountPipeline,
  buildTemplatesSearchPipeline,
  buildTemplatesCountPipeline,
  buildSubtasksSearchPipeline,
  buildSubtasksCountPipeline,
};
