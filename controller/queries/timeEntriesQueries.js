const { Types } = require("mongoose");

// Get time entries for a specific user grouped by date
exports.getUserTimeEntriesQuery = (userId) => {
  let queryArray = [];

  // Match time entries for the specific user that have endTime (completed entries only)
  queryArray.push({
    $match: {
      userId: Types.ObjectId.createFromHexString(userId),
      endTime: { $exists: true, $ne: null }
    }
  });

  // Add date grouping fields
  queryArray.push({
    $addFields: {
      startDate: {
        $dateToString: {
          format: "%Y-%m-%d",
          date: "$startTime"
        }
      },
      daysDiff: {
        $dateDiff: {
          startDate: { 
            $dateFromString: {
              dateString: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$startTime"
                }
              }
            }
          },
          endDate: {
            $dateFromString: {
              dateString: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: new Date()
                }
              }
            }
          },
          unit: "day"
        }
      }
    }
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
            { case: { $eq: ["$daysDiff", -6] }, then: "6 days ago" }
          ],
          default: {
            $dateToString: {
              format: "%B %d, %Y",
              date: "$startTime"
            }
          }
        }
      }
    }
  });

  // Project and format the individual entry fields
  queryArray.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      startTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$startTime"
        }
      },
      endTime: {
        $dateToString: {
          format: "%H:%M",
          date: "$endTime"
        }
      },
      totalTime: {
        $cond: {
          if: { $ne: ["$totalTime", null] },
          then: {
            $concat: [
              {
                $toString: {
                  $floor: { $divide: ["$totalTime", 60] }
                }
              },
              ":",
              {
                $cond: {
                  if: { $lt: [{ $mod: ["$totalTime", 60] }, 10] },
                  then: {
                    $concat: ["0", { $toString: { $mod: ["$totalTime", 60] } }]
                  },
                  else: { $toString: { $mod: ["$totalTime", 60] } }
                }
              },
              ":00"
            ]
          },
          else: "00:00:00"
        }
      },
      daysAdded: 1,
      isActive: 1,
      createdAt: 1,
      updatedAt: 1,
      startDate: 1,
      dayLabel: 1,
      daysDiff: 1
    }
  });

  // Group by day
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
          updatedAt: "$updatedAt"
        }
      },
      totalDayTime: { $sum: "$totalTime" }
    }
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
                  $floor: { $divide: ["$totalDayTime", 60] }
                }
              },
              ":",
              {
                $cond: {
                  if: { $lt: [{ $mod: ["$totalDayTime", 60] }, 10] },
                  then: {
                    $concat: ["0", { $toString: { $mod: ["$totalDayTime", 60] } }]
                  },
                  else: { $toString: { $mod: ["$totalDayTime", 60] } }
                }
              },
              ":00"
            ]
          },
          else: "00:00:00"
        }
      }
    }
  });

  // Sort by date (newest first)
  queryArray.push({
    $sort: {
      daysDiff: 1
    }
  });

  // Final projection
  queryArray.push({
    $project: {
      _id: 0,
      date: "$_id",
      dayLabel: 1,
      totalDayTime: "$totalDayTimeFormatted",
      entriesCount: { $size: "$entries" },
      entries: 1
    }
  });

  return queryArray;
};