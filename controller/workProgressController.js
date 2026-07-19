const { generateResponse, parseBody } = require("../utils");
const {
  STATUS_CODES,
  CONTRIBUTION_DURATIONS,
  CONTRIBUTION_CATEGORIES,
  ACTION_TYPE,
  TASK_STATUS,
} = require("../utils/constants");
const { findChannel } = require("../models/channelModel");
const { getAllActivities, createActivity } = require("../models/activityModel");
const { findManyTasks, updateTask } = require("../models/taskModel");
const { findManyProjects } = require("../models/projectModel");
const { findUser } = require("../models/userModel");
const { generateActivityMessage } = require("../utils");
const ActivityModel = require("mongoose").model("Activity");
const {
  getContributionsQuery,
  getActivitiesQuery,
} = require("./queries/workProgressQueries");

// Helper function to calculate date range based on duration
const calculateDateRange = (duration) => {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  
  let monthsBack;

  switch (duration) {
    case CONTRIBUTION_DURATIONS.CURRENT_MONTH.key:
      monthsBack = 0;
      break;
    case CONTRIBUTION_DURATIONS.THREE_MONTHS.key:
      monthsBack = 2; // Current month + 2 previous months = 3 months
      break;
    case CONTRIBUTION_DURATIONS.FOUR_MONTHS.key:
      monthsBack = 3; // Current month + 3 previous months = 4 months
      break;
    case CONTRIBUTION_DURATIONS.SIX_MONTHS.key:
      monthsBack = 5; // Current month + 5 previous months = 6 months
      break;
    case CONTRIBUTION_DURATIONS.EIGHT_MONTHS.key:
      monthsBack = 7; // Current month + 7 previous months = 8 months
      break;
    case CONTRIBUTION_DURATIONS.NINE_MONTHS.key:
      monthsBack = 8; // Current month + 8 previous months = 9 months
      break;
    case CONTRIBUTION_DURATIONS.TWELVE_MONTHS.key:
      monthsBack = 11; // Current month + 11 previous months = 12 months
      break;
    default:
      monthsBack = 0; // Default to current month
  }

  // Start date is the 1st of the starting month
  const startDate = new Date(currentYear, currentMonth - monthsBack, 1);
  startDate.setHours(0, 0, 0, 0);

  // End date is the last day of the current month
  const endDate = new Date(currentYear, currentMonth + 1, 0); // Last day of current month
  endDate.setHours(23, 59, 59, 999);

  // Actual end date for filtering data (today's date to exclude future dates)
  const actualEndDate = new Date(today);
  actualEndDate.setHours(23, 59, 59, 999);

  return { startDate, endDate, actualEndDate };
};

// Helper function to format date consistently (YYYY-MM-DD in local timezone)
const formatDateLocal = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Helper function to generate complete date range with missing dates
const generateCompleteDateRange = (startDate, endDate, contributions) => {
  const dateMap = new Map();
  const today = new Date();
  const todayStr = formatDateLocal(today);

  // Create a map of existing dates
  contributions.forEach((item) => {
    dateMap.set(item.date, {
      clientProgress: item.clientProgress,
      companyProgress: item.companyProgress,
    });
  });

  const completeDateRange = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = formatDateLocal(currentDate);
    const isAfterToday = currentDate > today;

    if (dateMap.has(dateStr)) {
      const dayData = dateMap.get(dateStr);
      completeDateRange.push({
        date: dateStr,
        clientProgress: dayData.clientProgress,
        companyProgress: dayData.companyProgress,
      });
    } else if (isAfterToday) {
      // Add future dates (after today) with null values
      completeDateRange.push({
        date: dateStr,
        clientProgress: null,
        companyProgress: null,
      });
    } else {
      // Add past dates with zero contributions
      completeDateRange.push({
        date: dateStr,
        clientProgress: {
          category: CONTRIBUTION_CATEGORIES.CLIENT_PROGRESS,
          count: 0,
          level: 0,
          activities: [],
        },
        companyProgress: {
          category: CONTRIBUTION_CATEGORIES.COMPANY_PROGRESS,
          count: 0,
          level: 0,
          activities: [],
        },
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return completeDateRange;
};

// Helper function to calculate channel task completion progress
const calculateChannelProgress = async (channelId) => {
  try {
    // Get all projects in this channel
    const projects = await findManyProjects({ channelId });
    const projectIds = projects.map(p => p._id);

    // Query all tasks in channel (both channel-based and project-based)
    const allTasks = await findManyTasks({
      $or: [
        { channelId, projectId: null }, // Channel-based tasks
        { projectId: { $in: projectIds } }, // Project-based tasks
      ],
      isActive: true,
    });

    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(
      (task) => task.isClosingStatus === true
    ).length;

    // Calculate percentage (rounded to 1 decimal)
    const progress = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 1000) / 10
      : 0;

    return {
      progress,
      totalTasks,
      completedTasks,
    };
  } catch (error) {
    console.error("Error calculating channel progress:", error);
    return {
      progress: 0,
      totalTasks: 0,
      completedTasks: 0,
    };
  }
};

// Helper function to calculate summary statistics
const calculateSummary = (contributions) => {
  // Filter out null entries for calculations (future dates)
  const validContributions = contributions.filter(
    (item) => item.clientProgress !== null && item.companyProgress !== null
  );

  const totalClientContributions = validContributions.reduce(
    (sum, item) => sum + item.clientProgress.count,
    0
  );

  const totalCompanyContributions = validContributions.reduce(
    (sum, item) => sum + item.companyProgress.count,
    0
  );

  const clientActiveDays = validContributions.filter(
    (item) => item.clientProgress.count > 0
  ).length;

  const companyActiveDays = validContributions.filter(
    (item) => item.companyProgress.count > 0
  ).length;

  const maxDailyClientContributions = Math.max(
    ...validContributions.map((item) => item.clientProgress.count),
    0
  );

  const maxDailyCompanyContributions = Math.max(
    ...validContributions.map((item) => item.companyProgress.count),
    0
  );

  const averageDailyClientContributions =
    validContributions.length > 0
      ? Math.round((totalClientContributions / validContributions.length) * 100) /
        100
      : 0;

  const averageDailyCompanyContributions =
    validContributions.length > 0
      ? Math.round((totalCompanyContributions / validContributions.length) * 100) /
        100
      : 0;

  return {
    totalClientContributions,
    totalCompanyContributions,
    clientActiveDays,
    companyActiveDays,
    maxDailyClientContributions,
    maxDailyCompanyContributions,
    averageDailyClientContributions,
    averageDailyCompanyContributions,
  };
};

/**
 * Get contributions data for work progress graph (channel-wide)
 */
exports.getContributions = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { duration = "current_month" } = req.query;
    const userId = req.user.id;

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Calculate date range based on duration
    const { startDate, endDate, actualEndDate } = calculateDateRange(duration);

    // Calculate channel task completion progress (time-independent)
    const channelProgress = await calculateChannelProgress(channelId);

    // Get contributions data (use actualEndDate to exclude future dates)
    const query = getContributionsQuery(channelId, startDate, actualEndDate);
    const contributions = await ActivityModel.aggregate(query);

    // Generate complete date range with missing dates filled (but only up to today)
    const completeContributions = generateCompleteDateRange(
      startDate,
      actualEndDate,
      contributions
    );

    // Calculate summary statistics
    const summary = calculateSummary(completeContributions);

    // Prepare response data
    const responseData = {
      duration,
      startDate: formatDateLocal(startDate),
      endDate: formatDateLocal(actualEndDate), // Show actual end date (today) not full month end
      progress: channelProgress.progress, // Channel task completion percentage
      clientProgress: {
        totalContributions: summary.totalClientContributions,
        dailyData: completeContributions.map((day) => ({
          date: day.date,
          count: day.clientProgress ? day.clientProgress.count : null,
          level: day.clientProgress ? day.clientProgress.level : null,
        })),
      },
      companyProgress: {
        totalContributions: summary.totalCompanyContributions,
        dailyData: completeContributions.map((day) => ({
          date: day.date,
          count: day.companyProgress ? day.companyProgress.count : null,
          level: day.companyProgress ? day.companyProgress.level : null,
        })),
      },
      summary: {
        totalContributions:
          summary.totalClientContributions + summary.totalCompanyContributions,
        clientContributions: summary.totalClientContributions,
        companyContributions: summary.totalCompanyContributions,
        maxDailyClientContributions: summary.maxDailyClientContributions,
        maxDailyCompanyContributions: summary.maxDailyCompanyContributions,
        clientActiveDays: summary.clientActiveDays,
        companyActiveDays: summary.companyActiveDays,
        averageDailyClientContributions:
          summary.averageDailyClientContributions,
        averageDailyCompanyContributions:
          summary.averageDailyCompanyContributions,
      },
      taskProgress: {
        totalTasks: channelProgress.totalTasks,
        completedTasks: channelProgress.completedTasks,
        percentage: channelProgress.progress,
      },
      context: {
        channel: {
          id: channelId,
          name: channel.channelName,
        },
      },
    };

    return generateResponse(
      responseData,
      "Work progress contributions fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getContributions:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch contributions",
    });
  }
};

/**
 * Get activities for work progress activity feed (channel-wide)
 */
exports.getActivities = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { duration = "current_month", page, limit } = req.query;
    const userId = req.user.id;

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Calculate date range based on duration
    const { startDate, endDate, actualEndDate } = calculateDateRange(duration);

    // Get activities data with pagination using getAllActivities (use actualEndDate to exclude future dates)
    const query = getActivitiesQuery(channelId, startDate, actualEndDate);

    const result = await getAllActivities({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "activities",
    });

    // Prepare response data with only required fields
    const responseData = {
      duration,
      startDate: formatDateLocal(startDate),
      endDate: formatDateLocal(actualEndDate), // Show actual end date (today) not full month end
      activities: result.activities,
      pagination: result.pagination,
      context: {
        channel: {
          id: channelId,
          name: channel.channelName,
        },
      },
    };

    return generateResponse(
      responseData,
      "Work progress activities fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getActivities:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch activities",
    });
  }
};

/**
 * Mark all tasks in a channel as completed
 */
exports.markAllTasksAsCompleted = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Get user info for activity messages
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const userName = user.name || user.email;

    // Get all projects in this channel
    const projects = await findManyProjects({ channelId });
    const projectIds = projects.map((p) => p._id);

    // Find all non-completed tasks in channel (both channel-based and project-based)
    const tasksToComplete = await findManyTasks({
      $or: [
        { channelId, projectId: null }, // Channel-based tasks
        { projectId: { $in: projectIds } }, // Project-based tasks
      ],
      isActive: true,
      isClosingStatus: { $ne: true }, // Not already in a closing status
    });

    let updatedCount = 0;
    const activities = [];

    // Update each task and create activity
    for (const task of tasksToComplete) {
      const previousStatus = task.status;

      // Update task status to completed
      await updateTask(
        { _id: task._id },
        {
          status: TASK_STATUS.COMPLETED,
          updatedAt: new Date()
        }
      );

      // Generate activity message
      const message = generateActivityMessage("status", userName, {
        previousValue: previousStatus,
        newValue: TASK_STATUS.COMPLETED,
        taskTitle: task.title,
        isCreation: false,
      });

      // Create activity
      const activityData = {
        taskId: task._id,
        userId,
        actionType: ACTION_TYPE.UPDATE_TASK,
        field: "status",
        previousValue: previousStatus,
        newValue: TASK_STATUS.COMPLETED,
        message,
        timestamp: new Date(),
      };

      // Add projectId or channelId based on task type
      if (task.projectId) {
        activityData.projectId = task.projectId;
      } else {
        activityData.channelId = task.channelId;
      }

      const activity = await createActivity(activityData);
      activities.push(activity);
      updatedCount++;
    }

    return generateResponse(
      {
        tasksUpdated: updatedCount,
        totalTasksInChannel: tasksToComplete.length + (await findManyTasks({
          $or: [
            { channelId, projectId: null },
            { projectId: { $in: projectIds } },
          ],
          isActive: true,
          isClosingStatus: true,
        })).length,
        activitiesCreated: activities.length,
      },
      `${updatedCount} task${updatedCount !== 1 ? 's' : ''} marked as completed`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in markAllTasksAsCompleted:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to mark tasks as completed",
    });
  }
};
