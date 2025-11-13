const { Types } = require("mongoose");

// Get time entries for a specific user grouped by date
exports.getUserTimeEntriesQuery = (userId, weekRange = null) => {
  let queryArray = [];

  // Build match criteria
  const matchCriteria = {
    userId: Types.ObjectId.createFromHexString(userId),
    endTime: { $exists: true, $ne: null },
    parentEntryId: null, // Only parent entries
  };

  // Add week range filtering if provided
  if (weekRange) {
    matchCriteria.startTime = {
      $gte: weekRange.start,
      $lte: weekRange.end,
    };
  }

  // Match time entries for the specific user that have endTime (completed entries only)
  // Only return parent entries (parentEntryId is null)
  // Filter by week range if provided
  queryArray.push({
    $match: matchCriteria,
  });

  // Add lookup to count children entries
  queryArray.push({
    $lookup: {
      from: "timeentries",
      localField: "_id",
      foreignField: "parentEntryId",
      as: "children",
    },
  });

  // Add children count field
  queryArray.push({
    $addFields: {
      childrenCount: { $size: "$children" },
    },
  });

  // Add date grouping fields
  queryArray.push({
    $addFields: {
      startDate: {
        $dateToString: {
          format: "%Y-%m-%d",
          date: "$startTime",
        },
      },
      daysDiff: {
        $dateDiff: {
          startDate: {
            $dateFromString: {
              dateString: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$startTime",
                },
              },
            },
          },
          endDate: {
            $dateFromString: {
              dateString: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: new Date(),
                },
              },
            },
          },
          unit: "day",
        },
      },
    },
  });

  // Add day label
  queryArray.push({
    $addFields: {
      dayLabel: {
        $switch: {
          branches: [
            { case: { $eq: ["$daysDiff", 0] }, then: "Today" },
            { case: { $eq: ["$daysDiff", -1] }, then: "Yesterday" },
            { case: { $eq: ["$daysDiff", -2] }, then: "2 days ago" },
            { case: { $eq: ["$daysDiff", -3] }, then: "3 days ago" },
            { case: { $eq: ["$daysDiff", -4] }, then: "4 days ago" },
            { case: { $eq: ["$daysDiff", -5] }, then: "5 days ago" },
            { case: { $eq: ["$daysDiff", -6] }, then: "6 days ago" },
          ],
          default: {
            $dateToString: {
              format: "%B %d, %Y",
              date: "$startTime",
            },
          },
        },
      },
    },
  });

  // Project and format the individual entry fields
  queryArray.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      tags: 1,
      startTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$startTime",
        },
      },
      endTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$endTime",
        },
      },
      totalTime: {
        $cond: {
          if: { $ne: ["$totalTime", null] },
          then: {
            $let: {
              vars: {
                totalMinutes: "$totalTime",
                hours: { $floor: { $divide: ["$totalTime", 60] } },
                minutes: { $floor: { $mod: ["$totalTime", 60] } },
                seconds: { $floor: { $multiply: [{ $mod: ["$totalTime", 1] }, 60] } }
              },
              in: {
                $concat: [
                  // Hours (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$hours", 10] },
                      then: { $concat: ["0", { $toString: "$$hours" }] },
                      else: { $toString: "$$hours" }
                    }
                  },
                  ":",
                  // Minutes (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$minutes", 10] },
                      then: { $concat: ["0", { $toString: "$$minutes" }] },
                      else: { $toString: "$$minutes" }
                    }
                  },
                  ":",
                  // Seconds (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$seconds", 10] },
                      then: { $concat: ["0", { $toString: "$$seconds" }] },
                      else: { $toString: "$$seconds" }
                    }
                  }
                ]
              }
            }
          },
          else: "00:00:00",
        },
      },
      daysAdded: 1,
      isActive: 1,
      createdAt: 1,
      updatedAt: 1,
      startDate: 1,
      dayLabel: 1,
      daysDiff: 1,
      childrenCount: 1,
    },
  });

  // Sort entries by creation time (newest first) before grouping
  queryArray.push({
    $sort: {
      startDate: 1, // Keep days in order for grouping
      createdAt: -1, // Within each day, newest entries first
    },
  });

  // Group by day (entries will maintain the sorted order)
  queryArray.push({
    $group: {
      _id: "$startDate",
      dayLabel: { $first: "$dayLabel" },
      daysDiff: { $first: "$daysDiff" },
      entries: {
        $push: {
          _id: "$_id",
          title: "$title",
          description: "$description",
          startTime: "$startTime",
          endTime: "$endTime",
          totalTime: "$totalTime",
          daysAdded: "$daysAdded",
          isActive: "$isActive",
          createdAt: "$createdAt",
          updatedAt: "$updatedAt",
          childrenCount: "$childrenCount",
        },
      },
      totalDayTime: { $sum: "$totalTime" },
    },
  });

  // Format total day time
  queryArray.push({
    $addFields: {
      totalDayTimeFormatted: {
        $cond: {
          if: { $ne: ["$totalDayTime", null] },
          then: {
            $concat: [
              {
                $toString: {
                  $floor: { $divide: ["$totalDayTime", 60] },
                },
              },
              ":",
              {
                $cond: {
                  if: { $lt: [{ $mod: ["$totalDayTime", 60] }, 10] },
                  then: {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$totalDayTime", 60] } },
                    ],
                  },
                  else: { $toString: { $mod: ["$totalDayTime", 60] } },
                },
              },
              ":00",
            ],
          },
          else: "00:00:00",
        },
      },
    },
  });

  // Sort by date (newest first)
  queryArray.push({
    $sort: {
      daysDiff: 1,
    },
  });

  // Final projection
  queryArray.push({
    $project: {
      _id: 0,
      date: "$_id",
      dayLabel: 1,
      totalDayTime: "$totalDayTimeFormatted",
      entriesCount: { $size: "$entries" },
      entries: 1,
    },
  });

  return queryArray;
};

// Get children entries of a specific parent time entry
exports.getChildrenTimeEntriesQuery = (parentEntryId) => {
  let queryArray = [];

  // Match child entries for the specific parent
  queryArray.push({
    $match: {
      parentEntryId: Types.ObjectId.createFromHexString(parentEntryId),
    },
  });

  // Sort by creation date (newest first)
  queryArray.push({
    $sort: {
      createdAt: -1,
    },
  });

  // Project and format the fields
  queryArray.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      tags: 1,
      startTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$startTime",
        },
      },
      endTime: {
        $cond: {
          if: { $ne: ["$endTime", null] },
          then: {
            $dateToString: {
              format: "%H:%M",
              date: "$endTime",
            },
          },
          else: null,
        },
      },
      totalTime: {
        $cond: {
          if: { $ne: ["$totalTime", null] },
          then: {
            $let: {
              vars: {
                totalMinutes: "$totalTime",
                hours: { $floor: { $divide: ["$totalTime", 60] } },
                minutes: { $floor: { $mod: ["$totalTime", 60] } },
                seconds: { $floor: { $multiply: [{ $mod: ["$totalTime", 1] }, 60] } }
              },
              in: {
                $concat: [
                  // Hours (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$hours", 10] },
                      then: { $concat: ["0", { $toString: "$$hours" }] },
                      else: { $toString: "$$hours" }
                    }
                  },
                  ":",
                  // Minutes (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$minutes", 10] },
                      then: { $concat: ["0", { $toString: "$$minutes" }] },
                      else: { $toString: "$$minutes" }
                    }
                  },
                  ":",
                  // Seconds (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$seconds", 10] },
                      then: { $concat: ["0", { $toString: "$$seconds" }] },
                      else: { $toString: "$$seconds" }
                    }
                  }
                ]
              }
            }
          },
          else: "00:00:00",
        },
      },
      daysAdded: 1,
      isActive: 1,
      createdAt: 1,
      updatedAt: 1,
      parentEntryId: 1,
    },
  });

  return queryArray;
};

// Get time entries report for a user with date range filtering
exports.getUserTimeEntriesReportQuery = (userId, startDate, endDate) => {
  let queryArray = [];

  // Match completed parent entries within date range
  queryArray.push({
    $match: {
      userId: Types.ObjectId.createFromHexString(userId),
      parentEntryId: null, // Only parent entries
      endTime: { $exists: true, $ne: null }, // Completed entries only
      startTime: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    },
  });

  // Lookup user details
  queryArray.push({
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "userDetails",
    },
  });

  // Unwind user details
  queryArray.push({
    $unwind: {
      path: "$userDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Lookup company details
  queryArray.push({
    $lookup: {
      from: "companies",
      localField: "userDetails.companyId",
      foreignField: "_id",
      as: "companyDetails",
    },
  });

  // Unwind company details
  queryArray.push({
    $unwind: {
      path: "$companyDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Add formatted fields
  queryArray.push({
    $addFields: {
      // Format date as "August 01, 2025"
      formattedDate: {
        $dateToString: {
          format: "%B %d, %Y",
          date: "$startTime",
        },
      },
      // Format duration as HH:MM:SS
      formattedDuration: {
        $cond: {
          if: { $ne: ["$totalTime", null] },
          then: {
            $let: {
              vars: {
                hours: { $floor: { $divide: ["$totalTime", 60] } },
                minutes: { $floor: { $mod: ["$totalTime", 60] } },
                seconds: {
                  $floor: { $multiply: [{ $mod: ["$totalTime", 1] }, 60] },
                },
              },
              in: {
                $concat: [
                  // Hours (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$hours", 10] },
                      then: { $concat: ["0", { $toString: "$$hours" }] },
                      else: { $toString: "$$hours" },
                    },
                  },
                  ":",
                  // Minutes (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$minutes", 10] },
                      then: { $concat: ["0", { $toString: "$$minutes" }] },
                      else: { $toString: "$$minutes" },
                    },
                  },
                  ":",
                  // Seconds (pad with zero if < 10)
                  {
                    $cond: {
                      if: { $lt: ["$$seconds", 10] },
                      then: { $concat: ["0", { $toString: "$$seconds" }] },
                      else: { $toString: "$$seconds" },
                    },
                  },
                ],
              },
            },
          },
          else: "00:00:00",
        },
      },
    },
  });

  // Project final fields
  queryArray.push({
    $project: {
      _id: 1,
      date: "$formattedDate",
      title: 1,
      description: 1,
      tags: 1,
      duration: "$formattedDuration",
      totalTimeMinutes: "$totalTime", // Keep for week total calculation
      userName: "$userDetails.name",
      userEmail: "$userDetails.email",
      companyName: "$companyDetails.companyName",
      startTime: 1, // Keep for sorting
      createdAt: 1,
    },
  });

  // Sort by startTime descending (newest first)
  queryArray.push({
    $sort: {
      startTime: -1,
    },
  });

  return queryArray;
};

// Get time entries with children for PDF download
exports.getUserTimeEntriesWithChildrenForDownloadQuery = (userId, startDate, endDate) => {
  let queryArray = [];

  // Match completed parent entries within date range
  queryArray.push({
    $match: {
      userId: Types.ObjectId.createFromHexString(userId),
      parentEntryId: null, // Only parent entries
      endTime: { $exists: true, $ne: null }, // Completed entries only
      startTime: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    },
  });

  // Lookup children entries
  queryArray.push({
    $lookup: {
      from: "timeentries",
      localField: "_id",
      foreignField: "parentEntryId",
      as: "children",
    },
  });

  // Lookup user details
  queryArray.push({
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "userDetails",
    },
  });

  // Unwind user details
  queryArray.push({
    $unwind: {
      path: "$userDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Lookup company details
  queryArray.push({
    $lookup: {
      from: "companies",
      localField: "userDetails.companyId",
      foreignField: "_id",
      as: "companyDetails",
    },
  });

  // Unwind company details
  queryArray.push({
    $unwind: {
      path: "$companyDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Add formatted date for grouping
  queryArray.push({
    $addFields: {
      formattedDate: {
        $dateToString: {
          format: "%B %d, %Y",
          date: "$startTime",
        },
      },
      formattedStartTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$startTime",
        },
      },
      formattedEndTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$endTime",
        },
      },
      // Format totalTime as HH:MM:SS for parent
      formattedDuration: {
        $cond: {
          if: { $ne: ["$totalTime", null] },
          then: {
            $let: {
              vars: {
                hours: { $floor: { $divide: ["$totalTime", 60] } },
                minutes: { $floor: { $mod: ["$totalTime", 60] } },
                seconds: {
                  $floor: { $multiply: [{ $mod: ["$totalTime", 1] }, 60] },
                },
              },
              in: {
                $concat: [
                  {
                    $cond: {
                      if: { $lt: ["$$hours", 10] },
                      then: { $concat: ["0", { $toString: "$$hours" }] },
                      else: { $toString: "$$hours" },
                    },
                  },
                  ":",
                  {
                    $cond: {
                      if: { $lt: ["$$minutes", 10] },
                      then: { $concat: ["0", { $toString: "$$minutes" }] },
                      else: { $toString: "$$minutes" },
                    },
                  },
                  ":",
                  {
                    $cond: {
                      if: { $lt: ["$$seconds", 10] },
                      then: { $concat: ["0", { $toString: "$$seconds" }] },
                      else: { $toString: "$$seconds" },
                    },
                  },
                ],
              },
            },
          },
          else: "00:00:00",
        },
      },
      // Format children with their times
      formattedChildren: {
        $map: {
          input: "$children",
          as: "child",
          in: {
            _id: "$$child._id",
            title: "$$child.title",
            description: "$$child.description",
            tags: "$$child.tags",
            startTime: {
              $dateToString: {
                format: "%H:%M",
                date: "$$child.startTime",
              },
            },
            endTime: {
              $cond: {
                if: { $ne: ["$$child.endTime", null] },
                then: {
                  $dateToString: {
                    format: "%H:%M",
                    date: "$$child.endTime",
                  },
                },
                else: "In Progress",
              },
            },
            duration: {
              $cond: {
                if: { $ne: ["$$child.totalTime", null] },
                then: {
                  $let: {
                    vars: {
                      hours: { $floor: { $divide: ["$$child.totalTime", 60] } },
                      minutes: { $floor: { $mod: ["$$child.totalTime", 60] } },
                      seconds: {
                        $floor: {
                          $multiply: [{ $mod: ["$$child.totalTime", 1] }, 60],
                        },
                      },
                    },
                    in: {
                      $concat: [
                        {
                          $cond: {
                            if: { $lt: ["$$hours", 10] },
                            then: { $concat: ["0", { $toString: "$$hours" }] },
                            else: { $toString: "$$hours" },
                          },
                        },
                        ":",
                        {
                          $cond: {
                            if: { $lt: ["$$minutes", 10] },
                            then: { $concat: ["0", { $toString: "$$minutes" }] },
                            else: { $toString: "$$minutes" },
                          },
                        },
                        ":",
                        {
                          $cond: {
                            if: { $lt: ["$$seconds", 10] },
                            then: { $concat: ["0", { $toString: "$$seconds" }] },
                            else: { $toString: "$$seconds" },
                          },
                        },
                      ],
                    },
                  },
                },
                else: "00:00:00",
              },
            },
            totalTimeMinutes: "$$child.totalTime",
          },
        },
      },
    },
  });

  // Project final fields for PDF generation
  queryArray.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      tags: 1,
      date: "$formattedDate",
      startTime: "$formattedStartTime",
      endTime: "$formattedEndTime",
      duration: "$formattedDuration",
      totalTimeMinutes: "$totalTime",
      children: "$formattedChildren",
      childrenCount: { $size: "$children" },
      userName: "$userDetails.name",
      userEmail: "$userDetails.email",
      userImage: "$userDetails.image",
      companyName: "$companyDetails.name",
      rawStartTime: "$startTime", // Keep for sorting
    },
  });

  // Sort by startTime descending (newest first)
  queryArray.push({
    $sort: {
      rawStartTime: -1,
    },
  });

  return queryArray;
};

// Get selected time entries with children for PDF download
exports.getUserSelectedTimeEntriesForDownloadQuery = (userId, entryIds) => {
  let queryArray = [];

  // Convert entry IDs to ObjectIds
  const objectIdEntryIds = entryIds.map(id => Types.ObjectId.createFromHexString(id));

  // Match selected parent entries
  queryArray.push({
    $match: {
      _id: { $in: objectIdEntryIds },
      userId: Types.ObjectId.createFromHexString(userId),
      parentEntryId: null, // Only parent entries
      endTime: { $exists: true, $ne: null }, // Completed entries only
    },
  });

  // Lookup children entries
  queryArray.push({
    $lookup: {
      from: "timeentries",
      localField: "_id",
      foreignField: "parentEntryId",
      as: "children",
    },
  });

  // Lookup user details
  queryArray.push({
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "userDetails",
    },
  });

  // Unwind user details
  queryArray.push({
    $unwind: {
      path: "$userDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Lookup company details
  queryArray.push({
    $lookup: {
      from: "companies",
      localField: "userDetails.companyId",
      foreignField: "_id",
      as: "companyDetails",
    },
  });

  // Unwind company details
  queryArray.push({
    $unwind: {
      path: "$companyDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Add formatted date for grouping
  queryArray.push({
    $addFields: {
      formattedDate: {
        $dateToString: {
          format: "%B %d, %Y",
          date: "$startTime",
        },
      },
      formattedStartTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$startTime",
        },
      },
      formattedEndTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$endTime",
        },
      },
      // Format totalTime as HH:MM:SS for parent
      formattedDuration: {
        $cond: {
          if: { $ne: ["$totalTime", null] },
          then: {
            $let: {
              vars: {
                hours: { $floor: { $divide: ["$totalTime", 60] } },
                minutes: { $floor: { $mod: ["$totalTime", 60] } },
                seconds: {
                  $floor: { $multiply: [{ $mod: ["$totalTime", 1] }, 60] },
                },
              },
              in: {
                $concat: [
                  {
                    $cond: {
                      if: { $lt: ["$$hours", 10] },
                      then: { $concat: ["0", { $toString: "$$hours" }] },
                      else: { $toString: "$$hours" },
                    },
                  },
                  ":",
                  {
                    $cond: {
                      if: { $lt: ["$$minutes", 10] },
                      then: { $concat: ["0", { $toString: "$$minutes" }] },
                      else: { $toString: "$$minutes" },
                    },
                  },
                  ":",
                  {
                    $cond: {
                      if: { $lt: ["$$seconds", 10] },
                      then: { $concat: ["0", { $toString: "$$seconds" }] },
                      else: { $toString: "$$seconds" },
                    },
                  },
                ],
              },
            },
          },
          else: "00:00:00",
        },
      },
      // Format children with their times
      formattedChildren: {
        $map: {
          input: "$children",
          as: "child",
          in: {
            _id: "$$child._id",
            title: "$$child.title",
            description: "$$child.description",
            tags: "$$child.tags",
            startTime: {
              $dateToString: {
                format: "%H:%M",
                date: "$$child.startTime",
              },
            },
            endTime: {
              $cond: {
                if: { $ne: ["$$child.endTime", null] },
                then: {
                  $dateToString: {
                    format: "%H:%M",
                    date: "$$child.endTime",
                  },
                },
                else: "In Progress",
              },
            },
            duration: {
              $cond: {
                if: { $ne: ["$$child.totalTime", null] },
                then: {
                  $let: {
                    vars: {
                      hours: { $floor: { $divide: ["$$child.totalTime", 60] } },
                      minutes: { $floor: { $mod: ["$$child.totalTime", 60] } },
                      seconds: {
                        $floor: {
                          $multiply: [{ $mod: ["$$child.totalTime", 1] }, 60],
                        },
                      },
                    },
                    in: {
                      $concat: [
                        {
                          $cond: {
                            if: { $lt: ["$$hours", 10] },
                            then: { $concat: ["0", { $toString: "$$hours" }] },
                            else: { $toString: "$$hours" },
                          },
                        },
                        ":",
                        {
                          $cond: {
                            if: { $lt: ["$$minutes", 10] },
                            then: { $concat: ["0", { $toString: "$$minutes" }] },
                            else: { $toString: "$$minutes" },
                          },
                        },
                        ":",
                        {
                          $cond: {
                            if: { $lt: ["$$seconds", 10] },
                            then: { $concat: ["0", { $toString: "$$seconds" }] },
                            else: { $toString: "$$seconds" },
                          },
                        },
                      ],
                    },
                  },
                },
                else: "00:00:00",
              },
            },
            totalTimeMinutes: "$$child.totalTime",
          },
        },
      },
    },
  });

  // Project final fields for PDF generation
  queryArray.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      date: "$formattedDate",
      startTime: "$formattedStartTime",
      endTime: "$formattedEndTime",
      duration: "$formattedDuration",
      totalTimeMinutes: "$totalTime",
      children: "$formattedChildren",
      childrenCount: { $size: "$children" },
      userName: "$userDetails.name",
      userEmail: "$userDetails.email",
      userImage: "$userDetails.image",
      companyName: "$companyDetails.name",
      userId: "$userId", // Include for permission validation
      companyId: "$userDetails.companyId", // Include for admin validation
      rawStartTime: "$startTime", // Keep for sorting
    },
  });

  // Sort by startTime descending (newest first)
  queryArray.push({
    $sort: {
      rawStartTime: -1,
    },
  });

  return queryArray;
};

// Get single time entry with children for PDF download
exports.getSingleTimeEntryWithChildrenForDownloadQuery = (entryId) => {
  let queryArray = [];

  // Match single parent entry by ID
  queryArray.push({
    $match: {
      _id: Types.ObjectId.createFromHexString(entryId),
      parentEntryId: null, // Must be parent entry
      endTime: { $exists: true, $ne: null }, // Must be completed
    },
  });

  // Lookup children entries
  queryArray.push({
    $lookup: {
      from: "timeentries",
      localField: "_id",
      foreignField: "parentEntryId",
      as: "children",
    },
  });

  // Lookup user details
  queryArray.push({
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "userDetails",
    },
  });

  // Unwind user details
  queryArray.push({
    $unwind: {
      path: "$userDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Lookup company details
  queryArray.push({
    $lookup: {
      from: "companies",
      localField: "userDetails.companyId",
      foreignField: "_id",
      as: "companyDetails",
    },
  });

  // Unwind company details
  queryArray.push({
    $unwind: {
      path: "$companyDetails",
      preserveNullAndEmptyArrays: true,
    },
  });

  // Add formatted date for display
  queryArray.push({
    $addFields: {
      formattedDate: {
        $dateToString: {
          format: "%B %d, %Y",
          date: "$startTime",
        },
      },
      formattedStartTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$startTime",
        },
      },
      formattedEndTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$endTime",
        },
      },
      // Format totalTime as HH:MM:SS for parent
      formattedDuration: {
        $cond: {
          if: { $ne: ["$totalTime", null] },
          then: {
            $let: {
              vars: {
                hours: { $floor: { $divide: ["$totalTime", 60] } },
                minutes: { $floor: { $mod: ["$totalTime", 60] } },
                seconds: {
                  $floor: { $multiply: [{ $mod: ["$totalTime", 1] }, 60] },
                },
              },
              in: {
                $concat: [
                  {
                    $cond: {
                      if: { $lt: ["$$hours", 10] },
                      then: { $concat: ["0", { $toString: "$$hours" }] },
                      else: { $toString: "$$hours" },
                    },
                  },
                  ":",
                  {
                    $cond: {
                      if: { $lt: ["$$minutes", 10] },
                      then: { $concat: ["0", { $toString: "$$minutes" }] },
                      else: { $toString: "$$minutes" },
                    },
                  },
                  ":",
                  {
                    $cond: {
                      if: { $lt: ["$$seconds", 10] },
                      then: { $concat: ["0", { $toString: "$$seconds" }] },
                      else: { $toString: "$$seconds" },
                    },
                  },
                ],
              },
            },
          },
          else: "00:00:00",
        },
      },
      // Format children with their times
      formattedChildren: {
        $map: {
          input: "$children",
          as: "child",
          in: {
            _id: "$$child._id",
            title: "$$child.title",
            description: "$$child.description",
            tags: "$$child.tags",
            startTime: {
              $dateToString: {
                format: "%H:%M",
                date: "$$child.startTime",
              },
            },
            endTime: {
              $cond: {
                if: { $ne: ["$$child.endTime", null] },
                then: {
                  $dateToString: {
                    format: "%H:%M",
                    date: "$$child.endTime",
                  },
                },
                else: "In Progress",
              },
            },
            duration: {
              $cond: {
                if: { $ne: ["$$child.totalTime", null] },
                then: {
                  $let: {
                    vars: {
                      hours: { $floor: { $divide: ["$$child.totalTime", 60] } },
                      minutes: { $floor: { $mod: ["$$child.totalTime", 60] } },
                      seconds: {
                        $floor: {
                          $multiply: [{ $mod: ["$$child.totalTime", 1] }, 60],
                        },
                      },
                    },
                    in: {
                      $concat: [
                        {
                          $cond: {
                            if: { $lt: ["$$hours", 10] },
                            then: { $concat: ["0", { $toString: "$$hours" }] },
                            else: { $toString: "$$hours" },
                          },
                        },
                        ":",
                        {
                          $cond: {
                            if: { $lt: ["$$minutes", 10] },
                            then: { $concat: ["0", { $toString: "$$minutes" }] },
                            else: { $toString: "$$minutes" },
                          },
                        },
                        ":",
                        {
                          $cond: {
                            if: { $lt: ["$$seconds", 10] },
                            then: { $concat: ["0", { $toString: "$$seconds" }] },
                            else: { $toString: "$$seconds" },
                          },
                        },
                      ],
                    },
                  },
                },
                else: "00:00:00",
              },
            },
            totalTimeMinutes: "$$child.totalTime",
          },
        },
      },
    },
  });

  // Project final fields for PDF generation
  queryArray.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      date: "$formattedDate",
      startTime: "$formattedStartTime",
      endTime: "$formattedEndTime",
      duration: "$formattedDuration",
      totalTimeMinutes: "$totalTime",
      children: "$formattedChildren",
      childrenCount: { $size: "$children" },
      userName: "$userDetails.name",
      userEmail: "$userDetails.email",
      userImage: "$userDetails.image",
      userId: "$userId",
      companyId: "$userDetails.companyId",
      companyName: "$companyDetails.name",
      entryDate: "$startTime", // Keep raw date for response
    },
  });

  return queryArray;
};
