"use strict";

const { STATUS_CODES } = require("../utils/constants");
const { generateResponse } = require("../utils");
const { findUser, getAllUsers, aggregateUsers } = require("../models/userModel");
const { getAllInviteSlots } = require("../models/inviteSlotModel");
const { getCompanyUsersAdminQuery, getInvitedUsersQuery } = require("./queries/adminQueries");

/**
 * Get all company users for admin management
 * Simple API - just returns active users with search and pagination
 */
exports.getCompanyUsersAdmin = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const userId = req.user.id;

    // Get admin user
    const admin = await findUser({ _id: userId });
    if (!admin) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Build aggregation query - exclude logged-in user and only show active users
    const aggregationQuery = getCompanyUsersAdminQuery(admin.companyId, search, userId);

    // Get users with pagination
    const result = await getAllUsers({
      query: aggregationQuery,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "users",
    });

    return generateResponse(
      result,
      "Company users fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );

  } catch (error) {
    console.error("Error in getCompanyUsersAdmin:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get invited users from reserved invite slots
 * Returns only invited users who haven't joined yet
 */
exports.getInvitedUsers = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const userId = req.user.id;

    // Get admin user
    const admin = await findUser({ _id: userId });
    if (!admin) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Build aggregation query for invited users with search
    let aggregationQuery = getInvitedUsersQuery(admin.companyId, search);

    // Get invite slots with pagination
    const result = await getAllInviteSlots({
      query: aggregationQuery,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "users",
    });

    return generateResponse(
      result,
      "Invited users fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );

  } catch (error) {
    console.error("Error in getInvitedUsers:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

