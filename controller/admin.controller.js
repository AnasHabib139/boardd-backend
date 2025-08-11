"use strict";

const { STATUS_CODES } = require("../utils/constants");
const { generateResponse } = require("../utils");
const { findUser, getAllUsers, aggregateUsers } = require("../models/userModel");
const { getAllInviteSlots, findInviteSlot, updateInviteSlot } = require("../models/inviteSlotModel");
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

/**
 * Cancel an invite for a specific user by slot ID
 * @param {Object} req - Request object
 * @param {Object} req.params.slotId - ID of the invite slot to cancel
 * @param {Object} req.user - Authenticated admin user
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {Object} Response with success message
 */
exports.cancelInvite = async (req, res, next) => {
  try {
    const { slotId } = req.params;
    const userId = req.user.id;

    // Get admin user
    const admin = await findUser({ _id: userId });
    if (!admin) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Admin user not found",
      });
    }

    // Find the invite slot
    const inviteSlot = await findInviteSlot({ _id: slotId });
    if (!inviteSlot) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Invite slot not found",
      });
    }

    // Verify the slot belongs to admin's company
    if (inviteSlot.companyId.toString() !== admin.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only cancel invites for your own company",
      });
    }

    // Check if slot is reserved and not used
    if (!inviteSlot.reserved || inviteSlot.used) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Can only cancel reserved but unused invites",
      });
    }

    // Store invite details before clearing
    const cancelledInviteDetails = {
      email: inviteSlot.reservedFor,
      role: inviteSlot.reservedRole,
      invitationDate: inviteSlot.reservedAt,
      cancelledAt: new Date(),
    };

    // Free up the slot by clearing reservation fields
    await updateInviteSlot(
      { _id: slotId },
      {
        reserved: false,
        reservedFor: null,
        reservedRole: null,
        reservedAt: null,
      }
    );

    return generateResponse(
      cancelledInviteDetails,
      "Invite cancelled successfully",
      res,
      STATUS_CODES.SUCCESS
    );

  } catch (error) {
    console.error("Error in cancelInvite:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

