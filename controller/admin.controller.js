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
  findManyInviteSlots,
  createManyInviteSlots,
} = require("../models/inviteSlotModel");
const { findCompany, updateCompany, findManyCompanies } = require("../models/companyModel");
const crypto = require("crypto");
const { generateJoinToken } = require("./helpers/users/signup.helper");
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
      search
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

    // Prevent admin from toggling their own seat
    if (targetUserId === adminId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "You cannot toggle your own seat status",
      });
    }

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

/**
 * Change user role with domain-based validation
 */
exports.changeUserRole = async (req, res, next) => {
  try {
    const { userId, role } = req.body;
    const adminId = req.user.id;
    
    // Validate required fields
    if (!userId || !role) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User ID and role are required",
      });
    }

    // Validate role is valid
    const { ROLES } = require("../utils/constants");
    if (!Object.values(ROLES).includes(role)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid role. Must be admin, employee, or guest",
      });
    }

    // Get admin user
    const admin = await findUser({ _id: adminId });
    if (!admin) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Admin user not found",
      });
    }

    // Get target user
    const targetUser = await findUser({ _id: userId });
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

    // Domain-based validation logic
    const targetUserDomain = extractDomainFromEmail(targetUser.email);
    const companyDomain = company.domain;
    const isSameDomain = targetUserDomain === companyDomain;

    // Validation rules:
    // 1. Cannot make employee -> guest
    // 2. Cannot make guest -> employee or admin
    // 3. Same domain users can only be admin/employee
    // 4. Different domain users can only be guest

    if (targetUser.role === ROLES.EMPLOYEE && role === ROLES.GUEST) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Members and Admins with a company email address cannot be assigned the Guest role",
      });
    }

    if (targetUser.role === ROLES.GUEST && (role === ROLES.EMPLOYEE || role === ROLES.ADMIN)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Guest users with an external email address cannot be assigned the Member or Admin role",
      });
    }

    if (isSameDomain && role === ROLES.GUEST) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Users with a company email address cannot be assigned the Guest role",
      });
    }

    if (!isSameDomain && (role === ROLES.ADMIN || role === ROLES.EMPLOYEE)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Users with an external email address can only be assigned the Guest role",
      });
    }

    // If role is same, no need to update
    if (targetUser.role === role) {
      return generateResponse(
        {
          userId: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          role: targetUser.role,
        },
        "User already has the specified role",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Update user role
    const updatedUser = await updateUser(
      { _id: userId },
      { role, updatedAt: new Date() }
    );

    return generateResponse(
      {
        userId: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        previousRole: targetUser.role,
        newRole: role,
      },
      `User role changed from ${({ employee: "Member", admin: "Admin", guest: "Guest" })[targetUser.role] || targetUser.role} to ${({ employee: "Member", admin: "Admin", guest: "Guest" })[role] || role} successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in changeUserRole:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to change user role",
    });
  }
};

/**
 * Sync invite seats for all existing companies
 * Tops up company and guest slots to match current env configuration
 * Idempotent — safe to run multiple times
 */
exports.syncSeats = async (req, res, next) => {
  try {
    const targetCompanySlots = parseInt(process.env.INVITE_SLOT_COUNT) || 5;
    const targetGuestSlots = parseInt(process.env.GUEST_INVITE_SLOT_COUNT) || 5;

    const companies = await findManyCompanies({});
    const results = [];

    for (const company of companies) {
      const existingCompanySlots = await findManyInviteSlots({
        companyId: company._id,
        inviteType: "company",
        isGuestInviteSlot: false,
      });

      const existingGuestSlots = await findManyInviteSlots({
        companyId: company._id,
        inviteType: "guest",
        isGuestInviteSlot: true,
      });

      // Find the current max slot number for this company
      const allSlots = await findManyInviteSlots({ companyId: company._id });
      const maxSlot = allSlots.reduce((max, s) => Math.max(max, s.slot), 0);

      const companyToAdd = targetCompanySlots - existingCompanySlots.length;
      const guestToAdd = targetGuestSlots - existingGuestSlots.length;

      const newSlots = [];
      let nextSlot = maxSlot + 1;

      if (companyToAdd > 0) {
        for (let i = 0; i < companyToAdd; i++) {
          newSlots.push({
            companyId: company._id,
            slot: nextSlot++,
            token: generateJoinToken(),
            isGuestInviteSlot: false,
            inviteType: "company",
          });
        }
      }

      if (guestToAdd > 0) {
        for (let i = 0; i < guestToAdd; i++) {
          newSlots.push({
            companyId: company._id,
            slot: nextSlot++,
            token: generateJoinToken(),
            isGuestInviteSlot: true,
            inviteType: "guest",
          });
        }
      }

      if (newSlots.length > 0) {
        await createManyInviteSlots(newSlots);
      }

      results.push({
        companyId: company._id,
        companyName: company.name,
        companySlotsAdded: Math.max(companyToAdd, 0),
        guestSlotsAdded: Math.max(guestToAdd, 0),
        totalCompanySlots: existingCompanySlots.length + Math.max(companyToAdd, 0),
        totalGuestSlots: existingGuestSlots.length + Math.max(guestToAdd, 0),
      });
    }

    return generateResponse(
      {
        targetCompanySlots,
        targetGuestSlots,
        companiesProcessed: companies.length,
        details: results,
      },
      "Seats synced successfully for all companies",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in syncSeats:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
