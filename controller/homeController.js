"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, TASK_STATUS } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { getAllRecentlyViewed } = require("../models/formViewModel");
const { findManyTasks } = require("../models/taskModel");
const ChatConversation = require("mongoose").model("ChatConversation");
const Channel = require("mongoose").model("Channel");
const {
  buildRecentlyViewedCombinedQuery,
  getDashboardStatsQuery,
} = require("./queries/homeQueries");

/**
 * Get combined recently viewed items (forms + tasks) for dashboard
 */
exports.getRecentlyViewed = async (req, res, next) => {
  try {
    const { limit, page } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Build aggregation query
    const query = buildRecentlyViewedCombinedQuery({ user });

    // Execute query with pagination using utility function
    const result = await getAllRecentlyViewed({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      responseKey: "items",
    });

    return generateResponse(
      result,
      "Recently viewed items fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getRecentlyViewed:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get dashboard statistics for user
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { search, page, limit } = req.query;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const companyId = user.companyId;

    // Parse pagination params
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    // Get user stats in parallel
    const [allTasksCount, completedTasksCount, conversationsCount] = await Promise.all([
      // Count all active tasks where user is creator or assigned
      findManyTasks({
        $or: [
          { createdBy: userId },
          { assignedTo: userId }
        ],
        isActive: true,
      }).then(tasks => tasks.length),

      // Count completed tasks
      findManyTasks({
        $or: [
          { createdBy: userId },
          { assignedTo: userId }
        ],
        isActive: true,
        status: TASK_STATUS.COMPLETED,
      }).then(tasks => tasks.length),

      // Count conversations (DM + Group DM only)
      ChatConversation.countDocuments({
        companyId,
        type: { $in: ["dm", "group_dm"] },
        participantIds: userId,
      })
    ]);

    // Calculate user progress percentage
    const progressPercentage = allTasksCount > 0
      ? Math.round((completedTasksCount / allTasksCount) * 1000) / 10
      : 0;

    // Get channels with task stats (with pagination)
    const query = getDashboardStatsQuery(userId, companyId, search, pageNum, limitNum);
    const result = await Channel.aggregate(query);

    // Extract data from faceted result
    const data = result[0] || {
      channels: [],
      metadata: []
    };

    const channels = data.channels || [];
    const total = data.metadata[0]?.total || 0;

    // Build pagination metadata
    const pagination = {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: pageNum < Math.ceil(total / limitNum),
      hasPrevPage: pageNum > 1,
    };

    const showJobTitle = user.settings?.profile?.showJobTitleInProfile !== false;

    const userDetails = {
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      coverImage: user.coverImage,
      role: user.role,
      nickname: user.nickname,
      gender: user.gender,
      dob: user.dob,
      description: user.description,
      ...(showJobTitle && { title: user.title, designation: user.designation }),
    };

    return generateResponse(
      {
        user: userDetails,
        userStats: {
          activeTaskCount: allTasksCount,
          taskCompletedCount: completedTasksCount,
          chatsCount: conversationsCount,
          progressPercentage,
        },
        channels,
        pagination,
      },
      "Dashboard stats fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getDashboardStats:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch dashboard stats",
    });
  }
};