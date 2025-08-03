const { Types } = require("mongoose");

/**
 * Get all team cards for a company with member details and progress
 * @param {string} companyId - Company ObjectId
 * @returns {Array} Aggregation pipeline
 */
exports.getTeamCardsWithMembersQuery = (companyId) => {
  return [
    // Match team cards for the company
    {
      $match: {
        companyId: new Types.ObjectId(companyId),
        isActive: true,
      },
    },
    
    // Sort by position and creation date
    { $sort: { position: 1, createdAt: 1 } },
    
    // Unwind members to work with individual members
    {
      $unwind: {
        path: "$members",
        preserveNullAndEmptyArrays: true,
      },
    },
    
    // Lookup user details for each member
    {
      $lookup: {
        from: "users",
        localField: "members.userId",
        foreignField: "_id",
        as: "memberUser",
      },
    },
    
    // Unwind user details
    {
      $unwind: {
        path: "$memberUser",
        preserveNullAndEmptyArrays: true,
      },
    },
    
    // Lookup subtasks assigned to this member
    {
      $lookup: {
        from: "subtasks",
        let: { userId: "$members.userId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $in: ["$$userId", "$assignedTo"]
              },
              // Only count active subtasks
              isActive: true
            }
          },
          {
            $project: {
              _id: 1,
              isCompleted: 1,
            }
          }
        ],
        as: "memberSubtasks",
      },
    },
    
    // Calculate progress for each member based on subtasks
    {
      $addFields: {
        "members.progress": {
          $cond: {
            if: { $gt: [{ $size: "$memberSubtasks" }, 0] },
            then: {
              $multiply: [
                {
                  $divide: [
                    {
                      $size: {
                        $filter: {
                          input: "$memberSubtasks",
                          cond: { $eq: ["$$this.isCompleted", true] }
                        }
                      }
                    },
                    { $size: "$memberSubtasks" }
                  ]
                },
                100
              ]
            },
            else: 0
          }
        },
        "members._id": "$members._id",
        "members.userId": "$members.userId",
        "members.name": "$memberUser.name",
        "members.email": "$memberUser.email",
        "members.designation": "$members.designation",
        "members.hashtags": "$members.hashtags",
        "members.backgroundColor": "$members.backgroundColor",
        "members.addedAt": "$members.addedAt",
      },
    },
    
    // Group back to reconstruct team cards with processed members
    {
      $group: {
        _id: "$_id",
        title: { $first: "$title" },
        position: { $first: "$position" },
        createdAt: { $first: "$createdAt" },
        updatedAt: { $first: "$updatedAt" },
        createdBy: { $first: "$createdBy" },
        companyId: { $first: "$companyId" },
        members: {
          $push: {
            $cond: {
              if: { $and: [
                { $ne: ["$members.userId", null] },
                { $ne: ["$memberUser", null] }
              ]},
              then: {
                _id: "$members._id",
                userId: "$members.userId", 
                name: "$members.name",
                email: "$members.email",
                designation: "$members.designation",
                hashtags: "$members.hashtags",
                backgroundColor: "$members.backgroundColor",
                addedAt: "$members.addedAt",
                progress: { $round: ["$members.progress", 1] } // Round to 1 decimal place
              },
              else: "$$REMOVE"
            }
          }
        },
      },
    },
    
    // Clean up members array to handle empty cases - filter out progress-only objects
    {
      $addFields: {
        members: {
          $filter: {
            input: "$members",
            cond: { 
              $and: [
                { $ne: ["$$this", null] },
                { $ne: ["$$this.userId", null] },
                { $ne: ["$$this.name", null] },
                { $ifNull: ["$$this.email", false] }
              ]
            }
          }
        }
      }
    },
    
    // Lookup creator details
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    
    // Unwind creator
    {
      $unwind: {
        path: "$creator",
        preserveNullAndEmptyArrays: true,
      },
    },
    
    // Final projection - always show members array (empty if no valid members)
    {
      $project: {
        _id: 1,
        title: 1,
        position: 1,
        createdAt: 1,
        updatedAt: 1,
        members: 1,
        createdBy: {
          _id: "$creator._id",
          name: "$creator.name",
          email: "$creator.email",
        },
      },
    },
    
    // Sort again after grouping
    { $sort: { position: 1, createdAt: 1 } },
  ];
};

/**
 * Get tasks for a specific member with filtering
 * @param {string} userId - User ObjectId
 * @param {string} filter - 'all', 'ongoing', 'completed'
 * @returns {Array} Aggregation pipeline
 */
exports.getMemberTasksQuery = (userId, filter = 'all') => {
  // Define status filter based on the filter parameter
  let statusMatch = {};
  switch (filter) {
    case 'ongoing':
      statusMatch = { status: { $in: ['todo', 'in_progress'] } };
      break;
    case 'completed':
      statusMatch = { status: 'completed' };
      break;
    case 'all':
    default:
      // No status filter for 'all'
      break;
  }

  return [
    // Match tasks assigned to the user
    {
      $match: {
        assignedTo: new Types.ObjectId(userId),
        $or: [
          { isDeleted: { $exists: false } },
          { isDeleted: false }
        ],
        ...statusMatch
      }
    },

    // Lookup project details
    {
      $lookup: {
        from: "projects",
        localField: "projectId",
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

    // Lookup channel tab details
    {
      $lookup: {
        from: "channeltabs",
        localField: "project.tabId",
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

    // Lookup channel details (for both project-based and direct channel tasks)
    {
      $lookup: {
        from: "channels",
        let: { 
          tabChannelId: "$tab.channelId",
          taskChannelId: "$channelId"
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$_id", "$$tabChannelId"] },
                  { $eq: ["$_id", "$$taskChannelId"] }
                ]
              }
            }
          }
        ],
        as: "channel",
      },
    },
    {
      $unwind: {
        path: "$channel",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Lookup subtasks to calculate task progress
    {
      $lookup: {
        from: "subtasks",
        localField: "_id",
        foreignField: "taskId",
        as: "subtasks",
      },
    },

    // Calculate task progress based on subtasks completion
    {
      $addFields: {
        taskProgress: {
          $cond: {
            if: { $gt: [{ $size: "$subtasks" }, 0] },
            then: {
              $multiply: [
                {
                  $divide: [
                    {
                      $size: {
                        $filter: {
                          input: "$subtasks",
                          cond: { 
                            $and: [
                              { $eq: ["$$this.isActive", true] },
                              { $eq: ["$$this.isCompleted", true] }
                            ]
                          }
                        }
                      }
                    },
                    {
                      $size: {
                        $filter: {
                          input: "$subtasks",
                          cond: { $eq: ["$$this.isActive", true] }
                        }
                      }
                    }
                  ]
                },
                100
              ]
            },
            else: {
              // Status-based progress if no subtasks
              $switch: {
                branches: [
                  { case: { $eq: ["$status", "todo"] }, then: 0 },
                  { case: { $eq: ["$status", "in_progress"] }, then: 50 },
                  { case: { $eq: ["$status", "completed"] }, then: 100 }
                ],
                default: 0
              }
            }
          }
        }
      }
    },

    // Final projection with required fields
    {
      $project: {
        _id: 1,
        title: 1,
        status: 1, // For verification
        priority: 1,
        dueDate: 1,
        createdAt: 1, // Start date
        taskProgress: { $round: ["$taskProgress", 1] },
        channelName: {
          $ifNull: ["$channel.channelName", "Unknown Channel"]
        },
        projectName: {
          $ifNull: ["$project.name", "Open"]
        },
        // Context path for better identification
        contextPath: {
          $cond: {
            if: "$project.name",
            then: {
              $concat: [
                { $ifNull: ["$channel.channelName", "Unknown"] },
                " / ",
                { $ifNull: ["$tab.tabName", "Unknown"] },
                " / ",
                { $ifNull: ["$project.name", "Unknown"] }
              ]
            },
            else: {
              $concat: [
                { $ifNull: ["$channel.channelName", "Unknown"] },
                " / Open"
              ]
            }
          }
        }
      }
    },

    // Sort by due date (closest first), then by creation date
    {
      $sort: {
        dueDate: 1,
        createdAt: -1
      }
    }
  ];
};