const { parseBody, generateResponse } = require("../utils");
const {
  STATUS_CODES,
  CONTRIBUTION_DURATIONS,
  CONTRIBUTION_CATEGORIES,
} = require("../utils/constants");
const { findChannel } = require("../models/channelModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findUser } = require("../models/userModel");
const { findCompany } = require("../models/companyModel");
const { getAllActivities } = require("../models/activityModel");
const ActivityModel = require("mongoose").model("Activity");
const {
  getContributionsQuery,
  getActivitiesQuery,
} = require("./queries/workProgressQueries");

// Helper function to calculate date range based on duration
const calculateDateRange = (duration) => {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  let startDate;

  switch (duration) {
    case CONTRIBUTION_DURATIONS.CURRENT_MONTH.key:
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case CONTRIBUTION_DURATIONS.SIX_MONTHS.key:
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      // Default to current month
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
  }

  return { startDate, endDate };
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

    if (dateMap.has(dateStr)) {
      const dayData = dateMap.get(dateStr);
      completeDateRange.push({
        date: dateStr,
        clientProgress: dayData.clientProgress,
        companyProgress: dayData.companyProgress,
      });
    } else {
      // Add missing date with zero contributions
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

// Helper function to calculate summary statistics
const calculateSummary = (contributions) => {
  const totalClientContributions = contributions.reduce(
    (sum, item) => sum + item.clientProgress.count,
    0
  );

  const totalCompanyContributions = contributions.reduce(
    (sum, item) => sum + item.companyProgress.count,
    0
  );

  const clientActiveDays = contributions.filter(
    (item) => item.clientProgress.count > 0
  ).length;

  const companyActiveDays = contributions.filter(
    (item) => item.companyProgress.count > 0
  ).length;

  const maxDailyClientContributions = Math.max(
    ...contributions.map((item) => item.clientProgress.count),
    0
  );

  const maxDailyCompanyContributions = Math.max(
    ...contributions.map((item) => item.companyProgress.count),
    0
  );

  const averageDailyClientContributions =
    contributions.length > 0
      ? Math.round((totalClientContributions / contributions.length) * 100) /
        100
      : 0;

  const averageDailyCompanyContributions =
    contributions.length > 0
      ? Math.round((totalCompanyContributions / contributions.length) * 100) /
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
    const { startDate, endDate } = calculateDateRange(duration);

    // Get contributions data
    const query = getContributionsQuery(channelId, startDate, endDate);
    const contributions = await ActivityModel.aggregate(query);

    // Generate complete date range with missing dates filled
    const completeContributions = generateCompleteDateRange(
      startDate,
      endDate,
      contributions
    );

    // Calculate summary statistics
    const summary = calculateSummary(completeContributions);

    // Prepare response data
    const responseData = {
      duration,
      startDate: formatDateLocal(startDate),
      endDate: formatDateLocal(endDate),
      clientProgress: {
        totalContributions: summary.totalClientContributions,
        dailyData: completeContributions.map((day) => ({
          date: day.date,
          count: day.clientProgress.count,
          level: day.clientProgress.level,
        })),
      },
      companyProgress: {
        totalContributions: summary.totalCompanyContributions,
        dailyData: completeContributions.map((day) => ({
          date: day.date,
          count: day.companyProgress.count,
          level: day.companyProgress.level,
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
    const { startDate, endDate } = calculateDateRange(duration);

    // Get activities data with pagination using getAllActivities
    const query = getActivitiesQuery(channelId, startDate, endDate);

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
      endDate: formatDateLocal(endDate),
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
