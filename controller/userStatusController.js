"use strict";

const { generateResponse, parseBody } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const {
  createOrUpdateUserStatus,
  findUserStatus,
  updateUserStatus,
} = require("../models/userStatusModel");

// Helper function to calculate expiration time
const getExpirationTime = (statusType) => {
  const now = new Date();
  
  switch (statusType) {
    case "meeting":
      // 1 hour from now
      return new Date(now.getTime() + 1 * 60 * 60 * 1000);
    
    case "focusing":
      // 2 hours from now
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    
    case "sick":
      // End of today (11:59:59 PM)
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay;
    
    case "vacation":
      // 1 week from now
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    case "custom":
      // No expiration
      return null;
    
    default:
      return null;
  }
};

// Helper function to get predefined status message
const getStatusMessage = (statusType, customMessage = null) => {
  if (statusType === "custom") {
    return customMessage || "What's your mood today?";
  }
  
  const messages = {
    meeting: "In a meeting",
    focusing: "Focusing",
    sick: "Called in sick",
    vacation: "On vacation",
  };
  
  return messages[statusType] || null;
};

/**
 * Set or update user status
 */
exports.setUserStatus = async (req, res, next) => {
  try {
    const { statusType, customMessage, statusEmoji } = parseBody(req.body);
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Calculate expiration time
    const expiresAt = getExpirationTime(statusType);
    
    // Get status message
    const statusMessage = getStatusMessage(statusType, customMessage);

    // Create or update user status (upsert)
    const userStatus = await createOrUpdateUserStatus(
      { userId },
      {
        userId,
        statusType,
        statusMessage,
        statusEmoji: statusEmoji || null,
        expiresAt,
        isActive: true,
        updatedAt: new Date(),
      }
    );

    return generateResponse(
      {
        statusType: userStatus.statusType,
        statusMessage: userStatus.statusMessage,
        statusEmoji: userStatus.statusEmoji,
        expiresAt: userStatus.expiresAt?.toISOString() || null,
        isActive: userStatus.isActive,
      },
      "User status updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in setUserStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get user status
 */
exports.getUserStatus = async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find user status
    const userStatus = await findUserStatus({ userId });
    
    if (!userStatus || !userStatus.isActive) {
      return generateResponse(
        {
          statusType: null,
          statusMessage: null,
          statusEmoji: null,
          expiresAt: null,
          isActive: false,
        },
        "User has no active status",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Check if status has expired
    const now = new Date();
    if (userStatus.expiresAt && userStatus.expiresAt <= now) {
      // Status has expired, clear it
      await updateUserStatus(
        { userId },
        {
          statusType: null,
          statusMessage: null,
          statusEmoji: null,
          expiresAt: null,
          isActive: false,
          updatedAt: new Date(),
        }
      );

      return generateResponse(
        {
          statusType: null,
          statusMessage: null,
          statusEmoji: null,
          expiresAt: null,
          isActive: false,
        },
        "Status has expired and been cleared",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    return generateResponse(
      {
        statusType: userStatus.statusType,
        statusMessage: userStatus.statusMessage,
        statusEmoji: userStatus.statusEmoji,
        expiresAt: userStatus.expiresAt?.toISOString() || null,
        isActive: userStatus.isActive,
      },
      "User status retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUserStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Clear user status
 */
exports.clearUserStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find user status
    const userStatus = await findUserStatus({ userId });
    if (!userStatus || !userStatus.isActive) {
      return generateResponse(
        { isActive: false },
        "User has no active status to clear",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Clear the status
    await updateUserStatus(
      { userId },
      {
        statusType: null,
        statusMessage: null,
        statusEmoji: null,
        expiresAt: null,
        isActive: false,
        updatedAt: new Date(),
      }
    );

    return generateResponse(
      {
        statusType: null,
        statusMessage: null,
        statusEmoji: null,
        expiresAt: null,
        isActive: false,
      },
      "User status cleared successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in clearUserStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get predefined status options
 */
exports.getStatusOptions = async (req, res, next) => {
  try {
    const statusOptions = [
      {
        statusType: "meeting",
        label: "In a meeting",
        emoji: "🏢",
        duration: "1 hour"
      },
      {
        statusType: "focusing",
        label: "Focusing",
        emoji: "🎯",
        duration: "2 hours"
      },
      {
        statusType: "sick",
        label: "Called in sick",
        emoji: "🤒",
        duration: "Today"
      },
      {
        statusType: "vacation",
        label: "On vacation",
        emoji: "🏖️",
        duration: "1 week"
      },
      {
        statusType: "custom",
        label: "What's your mood today?",
        emoji: "😊",
        duration: "No limit"
      }
    ];

    return generateResponse(
      { statusOptions },
      "Status options retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getStatusOptions:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};