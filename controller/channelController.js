const { findUser } = require("../models/userModel");
const { parseBody, extractDomainFromEmail } = require("../utils");
const { generateJoinToken } = require("./helpers/users/signup.helper");
const {
  createChannel,
  addMemberToChannel,
  findChannel,
  getAllChannelsDetails,
} = require("../models/channelModel");
const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { createChannelTab } = require("../models/channelTabsModel");
const {
  createDefaultTabs,
  getAdminsAndMergeMembers,
} = require("./helpers/channelTabs/channelTabs.helper");
const {
  getAllMembersInChannelQuery,
  getAllChannelsOfUserQuery,
} = require("./queries/channelQueries");
const { findCompany } = require("../models/companyModel");
// Import required functions
const {
  findInviteSlot,
} = require("../models/inviteSlotModel");
const Mailer = require("../utils/mailer");
const { generateChannelInviteEmail } = require("../utils/emailTemplates");
exports.createChannel = async (req, res, next) => {
  try {
    const { channelName, channelDescription, isPrivate } = parseBody(req.body);

    const userId = req.user.id;
    const user = await findUser({ _id: userId });

    // Get all company admins and merge with creator (avoiding duplicates)
    const allMembers = await getAdminsAndMergeMembers(user.companyId, [userId]);

    const channel = await createChannel({
      channelName,
      channelDescription,
      companyId: user.companyId,
      isPrivate,
      createdBy: userId,
      channelToken: generateJoinToken(),
      members: allMembers,
    });

    // create default tabs with admins included
    // const defaultTabs = await createDefaultTabs(
    //   channel._id,
    //   userId,
    //   user.companyId
    // );
    // // create default tabs with promise.all
    // await Promise.all(defaultTabs.map((tab) => createChannelTab(tab)));

    return generateResponse(
      channel,
      "Channel created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.log(error);
    next(error);
  }
};

// get channel joining link
exports.getChannelJoiningLink = async (req, res, next) => {
  try {
    const { channelId } = req.query;
    const currentUserId = req.user.id;

    // Get current user to check their company
    const currentUser = await findUser({ _id: currentUserId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Security Check: Verify the channel belongs to the user's company
    if (channel.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message:
          "You can only get joining links for channels from your own company",
      });
    }

    // Get company details
    const company = await findCompany({ _id: channel.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    // Generate simple channel joining link using channel ID
    const joiningLink = `${baseUrl}/channel/invite?channelId=${channel._id}`;

    // Send response
    return res.status(200).json({
      success: true,
      message: "Channel joining link fetched successfully",
      data: joiningLink,
      channelInfo: {
        id: channel._id,
        name: channel.channelName,
        description: channel.channelDescription,
      },
    });
  } catch (error) {
    console.log(error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// add multiple users to the channel
exports.addUserToChannel = async (req, res, next) => {
  try {
    const { emails, channelId } = parseBody(req.body);
    const requestingUserId = req.user.id; // Get ID of user making the request

    // Validate emails array
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Emails array is required and must not be empty",
      });
    }

    // Remove duplicates and validate email format
    const uniqueEmails = [...new Set(emails)];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = uniqueEmails.filter(
      (email) => !emailRegex.test(email)
    );

    if (invalidEmails.length > 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Invalid email format: ${invalidEmails.join(", ")}`,
      });
    }

    // Filter out demo user email and track for response
    const DEMO_EMAIL = "uncle@boardd.demo";
    const demoEmailsFound = uniqueEmails.filter(
      (email) => email.toLowerCase() === DEMO_EMAIL.toLowerCase()
    );
    const nonDemoEmails = uniqueEmails.filter(
      (email) => email.toLowerCase() !== DEMO_EMAIL.toLowerCase()
    );

    // Handle edge case: Only demo email(s) provided
    if (nonDemoEmails.length === 0 && demoEmailsFound.length > 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Uncle is a demo user and cannot be added to channels. Please provide other user emails.",
      });
    }

    // Handle edge case: No valid emails after filtering
    if (nonDemoEmails.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "No valid user emails provided",
      });
    }

    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // check if requesting user is a member of the channel
    if (!channel?.members?.includes(requestingUserId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only members of the channel can add users",
      });
    }

    // Get company details for domain check
    const company = await findCompany({ _id: channel.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Process each email and collect results (now using nonDemoEmails)
    const addedUsers = [];
    const errors = [];
    const usersToAdd = []; // Store valid user IDs to add to channel

    // Add demo user filtering notice to errors if demo emails were found
    if (demoEmailsFound.length > 0) {
      errors.push(
        `Uncle (demo user) cannot be added to channels - filtered out ${
          demoEmailsFound.length
        } demo email${demoEmailsFound.length > 1 ? "s" : ""}`
      );
    }

    for (const email of nonDemoEmails) {
      try {
        // Find user by email
        const user = await findUser({ email });
        if (!user) {
          errors.push(`User with email ${email} not found`);
          continue;
        }

        // Check if user is already a member of the company
        if (user.companyId.toString() !== channel.companyId.toString()) {
          errors.push(`User ${email} is not a member of the company`);
          continue;
        }

        // Check if user is active
        if (!user.isActive) {
          errors.push(`Cannot add inactive user: ${email}`);
          continue;
        }

        // Check if user is already a member of the channel
        if (channel?.members?.includes(user._id)) {
          errors.push(`User ${email} is already a member of the channel`);
          continue;
        }

        // Check if user's email domain matches company domain
        const userDomain = extractDomainFromEmail(email);
        if (userDomain !== company.domain) {
          errors.push(`User ${email} domain does not match company domain`);
          continue;
        }

        // If all validations pass, add to arrays
        usersToAdd.push(user._id);
        addedUsers.push({
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        });
      } catch (userError) {
        console.error(`Error processing user ${email}:`, userError);
        errors.push(`Failed to process user ${email}: ${userError.message}`);
      }
    }

    // Add all valid users to channel in a single operation
    let updatedChannel;
    if (usersToAdd.length > 0) {
      try {
        updatedChannel = await addMemberToChannel(
          { _id: channel._id },
          { $push: { members: { $each: usersToAdd } } }
        );
      } catch (updateError) {
        return next({
          statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
          message: `Failed to update channel: ${updateError.message}`,
        });
      }
    }

    // Prepare response
    const response = {
      addedUsers,
      totalAdded: addedUsers.length,
      totalRequested: uniqueEmails.length, // Original total including demo emails
      totalProcessed: nonDemoEmails.length, // Total after filtering demo emails
      channelId: channel._id,
      channelName: channel.channelName,
    };

    // Add demo filtering info to response if demo emails were found
    if (demoEmailsFound.length > 0) {
      response.filteredDemoEmails = demoEmailsFound.length;
    }

    if (errors.length > 0) {
      response.errors = errors;
      response.failed = errors.length;
    }

    // Determine response status and message
    if (addedUsers.length === 0 && errors.length > 0) {
      // No users added due to errors
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Failed to add any users to the channel: ${errors.join(", ")}`,
        errors,
      });
    } else if (addedUsers.length === 0) {
      // No users to add (all were already members, demo users, or duplicates)
      const message =
        demoEmailsFound.length > 0
          ? "No new users to add to the channel (demo users were filtered out)"
          : "No new users to add to the channel";
      return generateResponse(response, message, res, STATUS_CODES.SUCCESS);
    } else if (errors.length > 0) {
      // Partial success - some added, some failed
      const demoNote =
        demoEmailsFound.length > 0 ? " (demo users were filtered out)" : "";
      const message = `${addedUsers.length} users added successfully. ${errors.length} users failed to be added${demoNote}.`;
      return generateResponse(
        response,
        message,
        res,
        STATUS_CODES.PARTIAL_CONTENT
      );
    } else {
      // All users added successfully
      const demoNote =
        demoEmailsFound.length > 0 ? " (demo users were filtered out)" : "";
      const message = `All users added to the channel successfully${demoNote}`;
      return generateResponse(response, message, res, STATUS_CODES.SUCCESS);
    }
  } catch (error) {
    console.error("Error in addUserToChannel:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to add users to channel",
    });
  }
};

// get all members in  channel
exports.getAllMembersInChannel = async (req, res, next) => {
  try {
    const { channelId, page, limit } = req.query;
    const currentUserId = req.user.id; // Get current user ID

    // Get current user to check their company
    const currentUser = await findUser({ _id: currentUserId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Security Check: Verify the channel belongs to the user's company
    if (channel.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only view members of channels from your own company",
      });
    }

    const membersQuery = getAllMembersInChannelQuery(channelId, currentUserId);
    const result = await getAllChannelsDetails({
      query: membersQuery,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "members",
    });

    return generateResponse(
      result,
      "Members fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.log(error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// get all channels of a user in which he is a member
exports.getAllChannelsOfUser = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const userId = req.user.id;
    const query = getAllChannelsOfUserQuery(userId);

    const channels = await getAllChannelsDetails({
      query,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 10,
      responseKey: "channels",
    });

    return generateResponse(
      channels,
      "Channels fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.log(error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// Send channel invite emails
exports.sendChannelInviteEmails = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const {
      emails = [],
      allowGuests = false,
      channelDescription = null,
    } = parseBody(req.body);

    const inviterId = req.user.id;

    // Validate emails array
    if (!emails || emails.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Emails array is required and must not be empty",
      });
    }

    // Validate user exists
    const inviter = await findUser({ _id: inviterId });
    if (!inviter) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(inviterId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You must be a member of the channel to send invites",
      });
    }

    // Get company details
    const company = await findCompany({ _id: channel.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    const results = {
      successful: [],
      failed: [],
    };

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    
    // Generate simple invite link using channel ID (assuming users have accounts)
    const inviteLink = `${baseUrl}/channel/invite?channelId=${channel._id}`;

    // Process each email
    for (const email of emails) {
      try {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          results.failed.push({
            email,
            reason: "Invalid email format",
          });
          continue;
        }

        // Check if user exists (assuming users have accounts)
        const existingUser = await findUser({ email });
        if (!existingUser) {
          results.failed.push({
            email,
            reason: "User not found. User must have an account to join channels.",
          });
          continue;
        }

        // Check if user is already a channel member
        if (channel.members.includes(existingUser._id)) {
          results.failed.push({
            email,
            reason: "User is already a member of this channel",
          });
          continue;
        }

        // Check if user account is active
        if (!existingUser.isActive) {
          results.failed.push({
            email,
            reason: "User account is inactive",
          });
          continue;
        }

        // Prepare email content
        const subject = `Join ${channel.channelName} channel at ${company.name}`;
        const { html, text } = generateChannelInviteEmail({
          channelName: channel.channelName,
          companyName: company.name,
          inviteLink,
          inviterName: inviter.name,
          inviterEmail: inviter.email,
          channelDescription,
          isGuestInvite: false, // Simplified - no guest flow
        });

        // Send email
        await Mailer.sendEmail({
          email,
          subject,
          message: text,
          html: html,
          replyTo: inviter.email,
        });

        results.successful.push({
          email,
          inviteType: "existing_user",
          inviteLink,
          slotReserved: false, // No slot reservation needed
        });
      } catch (error) {
        console.error(`Error processing invite for ${email}:`, error);
        results.failed.push({
          email,
          reason: "Failed to send invite",
        });
      }
    }

    // Determine response
    const totalEmails = emails.length;
    const successfulEmails = results.successful.length;
    const failedEmails = results.failed.length;

    const response = {
      emailInvites: results,
      stats: {
        totalEmailsRequested: totalEmails,
        emailsSentSuccessfully: successfulEmails,
        emailsFailed: failedEmails,
      },
      channelInfo: {
        id: channel._id,
        name: channel.channelName,
      },
    };

    if (successfulEmails === 0 && failedEmails > 0) {
      // Return detailed error information instead of generic message
      return generateResponse(
        response,
        `Failed to send any channel invite emails. ${failedEmails} email${
          failedEmails > 1 ? "s" : ""
        } failed.`,
        res,
        STATUS_CODES.BAD_REQUEST
      );
    }

    const message =
      successfulEmails === totalEmails
        ? `All ${successfulEmails} channel invite emails sent successfully`
        : `${successfulEmails} of ${totalEmails} channel invite emails sent successfully`;

    const statusCode =
      failedEmails > 0 ? STATUS_CODES.PARTIAL_CONTENT : STATUS_CODES.SUCCESS;

    return generateResponse(response, message, res, statusCode);
  } catch (error) {
    console.error("Error in sendChannelInviteEmails:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to send channel invite emails",
    });
  }
};

// Join channel using invite token
exports.joinChannelWithInvite = async (req, res, next) => {
  try {
    const { token, flow, channelId } = parseBody(req.body);
    const currentUserId = req.user.id;

    // Input validation
    if (!token) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invite token is required",
      });
    }

    if (!flow || !["guest", "company"].includes(flow)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Flow must be either 'guest' or 'company'",
      });
    }

    if (!channelId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Channel ID is required",
      });
    }

    // Get current user
    const currentUser = await findUser({ _id: currentUserId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get channel details first
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Find invite slot by token
    const inviteSlot = await findInviteSlot({ token, used: false });
    if (!inviteSlot) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Invalid or already used invite token",
      });
    }

    // Validate flow matches slot type
    const isGuestFlow = flow === "guest";
    if (isGuestFlow !== inviteSlot.isGuestInviteSlot) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `This invite token is for ${
          inviteSlot.isGuestInviteSlot ? "guest" : "company"
        } users only`,
      });
    }

    // Validate that the invite slot belongs to the same company as the channel
    if (inviteSlot.companyId.toString() !== channel.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Invalid invite token for this channel",
      });
    }

    // Get company details
    const company = await findCompany({ _id: channel.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Validate user eligibility based on flow
    const userDomain = extractDomainFromEmail(currentUser.email);
    if (flow === "company") {
      // Company flow: user must be from same domain
      if (userDomain !== company.domain) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: `Company invites are only for ${company.domain} domain users`,
        });
      }
    }
    // Guest flow: any domain allowed

    // Check if user is already a member
    if (channel.members.includes(currentUserId)) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "You are already a member of this channel",
      });
    }

    // Check if user account is active
    if (!currentUser.isActive) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Your account is inactive. Please contact support.",
      });
    }

    // Add user to channel
    const updatedChannel = await addMemberToChannel(
      { _id: channel._id },
      { $push: { members: currentUserId } }
    );

    if (!updatedChannel) {
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Failed to add user to channel",
      });
    }

    // Mark invite slot as used and set the channelId
    await updateInviteSlot(
      { _id: inviteSlot._id },
      {
        used: true,
        usedBy: currentUserId,
        usedAt: new Date(),
        channelId: channel._id, // Set channelId when actually used
      }
    );

    // Prepare response data
    const responseData = {
      channel: {
        id: channel._id,
        name: channel.channelName,
        description: channel.channelDescription,
      },
      userRole: flow === "guest" ? "guest" : "member",
      joinedAt: new Date(),
      inviteType: flow,
    };

    // Add guest-specific info if applicable
    if (flow === "guest") {
      responseData.accessInfo = {
        type: "guest_access",
        note: "Guest access to channel",
      };
    }

    const message = `Successfully joined ${channel.channelName} channel as ${flow} user`;

    return generateResponse(responseData, message, res, STATUS_CODES.SUCCESS);
  } catch (error) {
    console.error("Error in joinChannelWithInvite:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to join channel",
    });
  }
};
