"use strict";

// get unused invite slot for the company
const { generateResponse, parseBody } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findCompany } = require("../models/companyModel");
const {
  findInviteSlot,
  updateInviteSlot,
  findAvailableInviteSlot,
} = require("../models/inviteSlotModel");
const Mailer = require("../utils/mailer");
const { generateInviteEmail } = require("../utils/emailTemplates");
const { findUser } = require("../models/userModel");

/**
 * Get unused invite slots for admin to share
 * @param {Object} req - Request object
 * @param {Object} req.query.joinToken - Company's public join token
 * @param {Object} req.user - Authenticated admin user
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {Object} Response with public and private invite links
 */
exports.getUnusedInviteSlot = async (req, res, next) => {
  try {
    const { joinToken } = req.query;
    const adminUserId = req.user.id;
    const adminUser = await findUser({ _id: adminUserId });

    // Find company by joinToken or admin's company ID
    let company;
    if (joinToken) {
      company = await findCompany({ joinToken });
    } else if (adminUser?.companyId) {
      company = await findCompany({ _id: adminUser.companyId });
    }

    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Find unused and unreserved invite slot for the company (COMPANY SLOTS ONLY)
    const unusedInviteSlot = await findAvailableInviteSlot({
      companyId: company._id,
      isGuestInviteSlot: false, // Only company slots for admin invites
    });

    if (!unusedInviteSlot) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "No unused invite slots available",
      });
    }

    // Generate hashmap for invite links
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const inviteLinks = {
      private: `${baseUrl}/signin?companyId=${company.domain}&token=${unusedInviteSlot.token}`,
      public: `${baseUrl}/signin?companyId=${company.domain}&joinToken=${company.joinToken}`,
    };

    return generateResponse(
      inviteLinks,
      "Invite links generated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUnusedInviteSlot:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// Add a new function to check if an email already has a reserved slot
const checkEmailAlreadyInvited = async (email, companyId) => {
  const existingInvite = await findInviteSlot({
    companyId,
    reservedFor: email,
    used: false,
  });
  return existingInvite !== null;
};

/**
 * Send invites to multiple users with different roles
 * @param {Object} req - Request object
 * @param {Object} req.body.invites - HashMap of email:role pairs
 * @param {Object} req.user - Authenticated user (admin)
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {Object} Response with success/error message
 */
exports.sendBulkInvites = async (req, res, next) => {
  try {
    const { invites } = parseBody(req.body);
    const adminUser = req.user;

    // Find admin's company
    const company = await findCompany({ adminUser: adminUser.id });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Validate all email domains before processing
    const invalidDomainEmails = [];
    for (const email of Object.keys(invites)) {
      const emailDomain = email.split("@")[1];
      if (emailDomain !== company.domain) {
        invalidDomainEmails.push({
          email,
          expectedDomain: company.domain,
          actualDomain: emailDomain,
        });
      }
    }

    // If any emails have invalid domains, reject the entire request
    if (invalidDomainEmails.length > 0) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: `All invited emails must belong to your company domain (${company.domain})`,
        data: {
          invalidEmails: invalidDomainEmails,
          validDomainExample: `user@${company.domain}`,
        },
      });
    }

    // Check if enough slots are available (COMPANY SLOTS ONLY)
    const availableSlots = await findAvailableInviteSlot({
      companyId: company._id,
      isGuestInviteSlot: false, // Only company slots for bulk invites
    });
    if (!availableSlots) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "No available company invite slots. Please upgrade your plan.",
      });
    }

    // Process each invite
    const results = {
      successful: [],
      failed: [],
    };

    for (const [email, role] of Object.entries(invites)) {
      try {
        // Check if user already exists in the company
        const existingUser = await findUser({ email });
        if (
          existingUser &&
          existingUser.companyId &&
          existingUser.companyId.toString() === company._id.toString()
        ) {
          results.failed.push({
            email,
            reason: "User is already a member of this company",
          });
          continue;
        }

        // Check if email already has a reserved slot
        const alreadyInvited = await checkEmailAlreadyInvited(
          email,
          company._id
        );
        if (alreadyInvited) {
          results.failed.push({
            email,
            reason: "This email already has an active invite",
          });
          continue;
        }

        // Find an available slot (COMPANY SLOTS ONLY)
        const availableSlot = await findAvailableInviteSlot({
          companyId: company._id,
          isGuestInviteSlot: false, // Only company slots for bulk invites
        });
        if (!availableSlot) {
          results.failed.push({
            email,
            reason: "No more invite slots available",
          });
          break; // Stop processing if no more slots
        }

        // Generate invite token if not already present
        const inviteToken = availableSlot.token;

        // Create invite link
        const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const inviteLink = `${baseUrl}/signin?companyId=${company.domain}&token=${inviteToken}`;

        // Prepare email content using the template
        const subject = `Invitation to join ${company.name}`;
        const { html, text } = generateInviteEmail({
          companyName: company.name,
          role,
          inviteLink,
          adminName: adminUser.name,
          adminEmail: adminUser.email,
        });

        // Send email
        await Mailer.sendEmail({
          email,
          subject,
          message: text,
          html: html,
          replyTo: adminUser.email,
        });

        // Mark slot as reserved (not used yet) with timestamp
        await updateInviteSlot(
          { _id: availableSlot._id },
          { 
            reserved: true, 
            reservedFor: email, 
            reservedRole: role,
            reservedAt: new Date() // Explicitly set the reservation timestamp
          }
        );

        results.successful.push({ email, role });
      } catch (error) {
        console.error(`Error sending invite to ${email}:`, error);
        results.failed.push({ email, reason: "Failed to send invite" });
      }
    }

    // Return results
    if (results.successful.length === 0) {
      return next({
        statusCode: STATUS_CODES.UNPROCESSABLE_ENTITY,
        message: "Failed to send any invites",
      });
    }

    if (results.failed.length > 0) {
      return generateResponse(
        results,
        "Invites sent successfully",
        res,
        STATUS_CODES.PARTIAL_CONTENT
      );
    }

    return generateResponse(
      results,
      `Successfully sent all ${results.successful.length} invites`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in sendBulkInvites:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
