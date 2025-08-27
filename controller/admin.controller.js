"use strict";

const { STATUS_CODES } = require("../utils/constants");
const { generateResponse, extractDomainFromEmail } = require("../utils");
const {
  findUser,
  getAllUsers,
  aggregateUsers,
  updateUser,
} = require("../models/userModel");
const {
  getAllInviteSlots,
  findInviteSlot,
  updateInviteSlot,
  findAvailableInviteSlot,
} = require("../models/inviteSlotModel");
const { findCompany, updateCompany } = require("../models/companyModel");
const crypto = require("crypto");
const Mailer = require("../utils/mailer");
const { generateOwnershipTransferEmail } = require("../utils/emailTemplates");
const {
  getCompanyUsersAdminQuery,
  getInvitedUsersQuery,
} = require("./queries/adminQueries");

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
    const aggregationQuery = getCompanyUsersAdminQuery(
      admin.companyId,
      search,
      userId
    );

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

/**
 * Toggle user seat status (approve/disapprove)
 * If user is inactive -> approve (activate user and use slot)
 * If user is active -> disapprove (deactivate user and free slot)
 */
exports.toggleUserSeat = async (req, res, next) => {
  try {
    const { userId: targetUserId } = req.body;
    const adminId = req.user.id;

    // Get admin user
    const admin = await findUser({ _id: adminId });
    if (!admin) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Admin user not found",
      });
    }

    // Find the target user
    const targetUser = await findUser({ _id: targetUserId });
    if (!targetUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Verify user belongs to admin's company
    if (targetUser.companyId.toString() !== admin.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only manage users from your own company",
      });
    }

    // Get company details to check domain
    const company = await findCompany({ _id: admin.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Determine if target user is company user or guest user
    const targetUserDomain = extractDomainFromEmail(targetUser.email);
    const adminDomain = extractDomainFromEmail(admin.email);
    const companyDomain = company.domain;
    
    // User is a company user if their domain matches company domain or admin domain
    const isCompanyUser = targetUserDomain === companyDomain || targetUserDomain === adminDomain;
    
    // Determine slot type to use
    const slotType = isCompanyUser ? "company" : "guest";

    let responseData;
    let responseMessage;

    if (!targetUser.isActive) {
      // User is inactive -> Approve (activate user)

      // Find an available slot of the appropriate type
      const availableSlot = await findAvailableInviteSlot({
        companyId: admin.companyId,
        inviteType: slotType
      });

      if (!availableSlot) {
        const slotTypeDisplay = isCompanyUser ? "company" : "guest";
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `No available ${slotTypeDisplay} seats to approve this user`,
        });
      }

      // Mark the slot as used
      await updateInviteSlot({ _id: availableSlot._id }, { used: true });

      // Activate the user
      await updateUser({ _id: targetUserId }, { isActive: true });

      responseData = {
        user: {
          _id: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          isActive: true,
        },
        action: "approved",
        slot: availableSlot.slot,
        slotType: slotType,
      };
      responseMessage = `User ${slotType} seat approved successfully`;
    } else {
      // User is active -> Disapprove (deactivate user)

      // Find a used slot of the appropriate type to free up
      const usedSlot = await findInviteSlot({
        companyId: admin.companyId,
        used: true,
        inviteType: slotType
      });

      if (!usedSlot) {
        const slotTypeDisplay = isCompanyUser ? "company" : "guest";
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `No used ${slotTypeDisplay} slots found to free up`,
        });
      }

      // Free up the slot
      await updateInviteSlot({ _id: usedSlot._id }, { used: false });

      // Deactivate the user
      await updateUser({ _id: targetUserId }, { isActive: false });

      responseData = {
        user: {
          _id: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          isActive: false,
        },
        action: "disapproved",
        slot: usedSlot.slot,
        slotType: slotType,
      };
      responseMessage = `User ${slotType} seat removed successfully`;
    }

    return generateResponse(
      responseData,
      responseMessage,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in toggleUserSeat:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

const {
  createOwnershipTransfer,
  findOwnershipTransferByToken,
  markOwnershipTransferUsed,
} = require("../models/ownershipTransferModel");

/**
 * Initiate ownership transfer process
 * Sends confirmation email to current owner
 */
exports.initiateOwnershipTransfer = async (req, res, next) => {
  try {
    const { newOwnerId } = req.body;
    const currentAdminId = req.user.id;

    // Get current admin user
    const currentAdmin = await findUser({ _id: currentAdminId });
    if (!currentAdmin) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Current admin not found",
      });
    }

    // Get company details
    const company = await findCompany({ _id: currentAdmin.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Verify current user is the company admin
    if (company.adminUser.toString() !== currentAdminId) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only the company owner can transfer ownership",
      });
    }

    // Get new owner user
    const newOwner = await findUser({ _id: newOwnerId });
    if (!newOwner) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "New owner not found",
      });
    }

    // Verify new owner belongs to same company
    if (newOwner.companyId.toString() !== company._id.toString()) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "New owner must be a member of the same company",
      });
    }

    // Check if new owner is already an admin
    if (newOwner.role === "admin") {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "New owner is already an admin",
      });
    }

    // Generate secure transfer token
    const transferToken = crypto.randomBytes(32).toString("hex");

    // Persist transfer record (24 hours expiry)
    await createOwnershipTransfer({
      token: transferToken,
      companyId: company._id,
      currentOwnerId: currentAdminId,
      newOwnerId: newOwnerId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // Create confirmation link (Frontend handles confirmation UI)
    const confirmationLink = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/owner-transfer-confirm?token=${transferToken}`;

    // Generate email template
    const emailTemplate = generateOwnershipTransferEmail({
      currentOwnerName: currentAdmin.name,
      newOwnerName: newOwner.name,
      newOwnerEmail: newOwner.email,
      companyName: company.name,
      confirmationLink,
    });

    // Send confirmation email
    await Mailer.sendEmail({
      email: currentAdmin.email,
      subject: `🏢 Confirm Ownership Transfer - ${company.name}`,
      message: emailTemplate.text,
      html: emailTemplate.html,
    });

    return generateResponse(
      {
        message: "Transfer initiated successfully",
        newOwner: {
          _id: newOwner._id,
          name: newOwner.name,
          email: newOwner.email,
        },
        confirmationSentTo: currentAdmin.email,
      },
      "Ownership transfer initiated. Please check your email to confirm.",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in initiateOwnershipTransfer:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Confirm ownership transfer via token (public JSON API)
 */
exports.confirmOwnershipTransfer = async (req, res, next) => {
  try {
    const { token } = req.body;

    // Load token from DB
    const transferDoc = await findOwnershipTransferByToken(token);
    if (!transferDoc) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid or expired transfer token",
      });
    }

    // Check if token already used or expired
    if (transferDoc.used) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Transfer link has already been used",
      });
    }

    if (new Date() > transferDoc.expiresAt) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Transfer link has expired",
      });
    }

    // Get company and users
    const company = await findCompany({ _id: transferDoc.companyId });
    const currentOwner = await findUser({ _id: transferDoc.currentOwnerId });
    const newOwner = await findUser({ _id: transferDoc.newOwnerId });

    if (!company || !currentOwner || !newOwner) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Unable to find company or user information",
      });
    }

    // Perform the ownership transfer
    // 1. Update company adminUser
    await updateCompany({ _id: company._id }, { adminUser: newOwner._id });

    // 2. Update current owner role to employee
    await updateUser({ _id: currentOwner._id }, { role: "employee" });

    // 3. Update new owner role to admin
    await updateUser({ _id: newOwner._id }, { role: "admin" });

    // Mark token used
    await markOwnershipTransferUsed(token);

    // Return JSON success
    return generateResponse(
      {
        company: { _id: company._id, name: company.name },
        newOwner: {
          _id: newOwner._id,
          name: newOwner.name,
          email: newOwner.email,
        },
        previousOwner: {
          _id: currentOwner._id,
          name: currentOwner.name,
          email: currentOwner.email,
        },
      },
      "Ownership transfer confirmed",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in confirmOwnershipTransfer:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
