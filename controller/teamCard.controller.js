"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, ACTION_TYPE } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const {
  createTeamCard,
  findTeamCard,
  getAllTeamCards,
  getNextPosition,
  addMemberToCard,
  removeMemberFromCard,
} = require("../models/teamCardModel");
const { getTeamCardsWithMembersQuery, getMemberTasksQuery } = require("./queries/teamCardsQueries");
const { getAllTasks } = require("../models/taskModel");
/**
 * Create a new team card
 */
exports.createTeamCard = async (req, res, next) => {
  try {
    const { title } = parseBody(req.body);
    const userId = req.user.id;

    // Validate required fields
    if (!title) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "title is required",
      });
    }

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user is admin (only admins can create team cards)
    if (user.role !== "admin") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only admins can create team management cards",
      });
    }

    if (!user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must be associated with a company",
      });
    }

    // Get next position for ordering
    const position = await getNextPosition(user.companyId);

    // Create team card
    const teamCard = await createTeamCard({
      companyId: user.companyId,
      title,
      position,
      createdBy: userId,
    });

    return generateResponse(
      teamCard,
      "Team card created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createTeamCard:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to create team card",
    });
  }
};

/**
 * Add member to team card
 */
exports.addMemberToCard = async (req, res, next) => {
  try {
    const { cardId } = req.params;
    const { memberId, designation, hashtags, backgroundColor } = parseBody(
      req.body
    );
    const userId = req.user.id;

    // Validate required fields
    if (!memberId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "memberId is required",
      });
    }

    // Find team card
    const teamCard = await findTeamCard({ _id: cardId, isActive: true });
    if (!teamCard) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Team card not found",
      });
    }

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user is admin (only admins can add members to team cards)
    if (user.role !== "admin") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only admins can add members to team cards",
      });
    }

    // Validate member exists and is in same company
    const member = await findUser({ _id: memberId });
    if (!member) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Member not found",
      });
    }

    if (member.companyId.toString() !== teamCard.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Member must be from the same company",
      });
    }

    // Add member to card with additional properties
    const memberData = {
      userId: memberId,
      designation: designation || "",
      hashtags: hashtags || [],
      backgroundColor: backgroundColor || "#6C63FF",
    };

    const updatedCard = await addMemberToCard(cardId, memberData);

    return generateResponse(
      updatedCard,
      "Member added to team card successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in addMemberToCard:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to add member to team card",
    });
  }
};

/**
 * Remove member from team card
 */
exports.removeMemberFromCard = async (req, res, next) => {
  try {
    const { cardId } = req.params;
    const { memberId } = parseBody(req.body);
    const userId = req.user.id;

    // Validate required fields
    if (!memberId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "memberId is required",
      });
    }

    // Find team card
    const teamCard = await findTeamCard({ _id: cardId, isActive: true });
    if (!teamCard) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Team card not found",
      });
    }

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user is admin (only admins can remove members from team cards)
    if (user.role !== "admin") {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only admins can remove members from team cards",
      });
    }

    // Check if member is in the card
    const memberExists = teamCard.members.some(
      (member) => member.userId.toString() === memberId
    );
    if (!memberExists) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Member is not in this team card",
      });
    }

    // Get member info for notifications
    const member = await findUser({ _id: memberId });

    // Remove member from card
    const updatedCard = await removeMemberFromCard(cardId, memberId);

    return generateResponse(
      updatedCard,
      "Member removed from team card successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in removeMemberFromCard:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to remove member from team card",
    });
  }
};

/**
 * Get all team cards for a company
 */
exports.getTeamCards = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;

    // Get user info to determine company
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    if (!user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must be associated with a company",
      });
    }

    // Get team cards with member details and progress
    const query = getTeamCardsWithMembersQuery(user.companyId);

    const result = await getAllTeamCards({
      query,
      page: parseInt(page),
      limit: parseInt(limit),
      responseKey: "teamCards",
      sort: { position: 1 }, // Override default sort to use position
    });

    return generateResponse(
      result,
      "Team cards fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getTeamCards:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch team cards",
    });
  }
};

/**
 * Get member profile with tasks
 */
exports.getMemberProfile = async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { page = 1, limit = 20, filter = 'all' } = req.query;
    const userId = req.user?.id;

    // Validate filter parameter
    const validFilters = ['all', 'ongoing', 'completed'];
    if (!validFilters.includes(filter)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid filter. Must be 'all', 'ongoing', or 'completed'",
      });
    }

    // Get user info to check company access
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get member info
    const member = await findUser({ _id: memberId });
    if (!member) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Member not found",
      });
    }

    // Check if both users are from the same company
    if (currentUser.companyId.toString() !== member.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only view profiles of members from your company",
      });
    }

    // Get member tasks with the specified filter
    const query = getMemberTasksQuery(memberId, filter);

    const result = await getAllTasks({
      query,
      page: parseInt(page),
      limit: parseInt(limit),
      responseKey: "tasks",
      sort: { dueDate: 1, createdAt: -1 }, // Override default sort
    });

    // Add member info to response
    const response = {
      member: {
        _id: member._id,
        name: member.name,
        email: member.email,
        role: member.role,
      },
      filter: filter,
      ...result
    };

    return generateResponse(
      response,
      `Member ${filter} tasks fetched successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getMemberProfile:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch member profile",
    });
  }
};
