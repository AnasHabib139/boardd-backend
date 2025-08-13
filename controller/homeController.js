"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { getAllRecentlyViewed } = require("../models/formViewModel");
const {
  buildRecentlyViewedCombinedQuery,
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