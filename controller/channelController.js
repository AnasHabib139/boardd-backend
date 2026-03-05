const { findUser } = require("../models/userModel");
const { parseBody, extractDomainFromEmail } = require("../utils");
const { generateJoinToken } = require("./helpers/users/signup.helper");
const {
  createChannel,
  addMemberToChannel,
  findChannel,
  getAllChannelsDetails,
  updateChannel,
  addFilesToChannel,
  removeFileFromChannel,
  findManyChannels,
} = require("../models/channelModel");
const { createChatConversation, addChannelParticipant, findChatConversation, updateLastMessage } = require("../models/chatConversationModel");
const { createChatMessage } = require("../models/chatMessageModel");
const { findTask, updateTask, aggregateTasks } = require("../models/taskModel");
const mongoose = require("mongoose");
const { findProject } = require("../models/projectModel");
const { handleAttachmentsActivity } = require("./helpers/tasks/task.helper");
const { createNotification } = require("../models/notificationModel");
const { generateResponse } = require("../utils");
const { STATUS_CODES, ROLES } = require("../utils/constants");
const { getIO, emitUnreadCountsUpdate } = require("../utils/socket");
const {
  createChannelTab,
  getAllTabs,
  updateChannelTab,
} = require("../models/channelTabsModel");
const {
  createDefaultTabs,
  getAdminsAndMergeMembers,
} = require("./helpers/channelTabs/channelTabs.helper");
const {
  getAllMembersInChannelQuery,
  getAllChannelsOfUserQuery,
  getArchivedChannelsQuery,
  getChannelFilesQuery,
} = require("./queries/channelQueries");
const { findCompany } = require("../models/companyModel");
// Import required functions
const { findInviteSlot, updateInviteSlot } = require("../models/inviteSlotModel");
const Mailer = require("../utils/mailer");
const { generateChannelInviteEmail } = require("../utils/emailTemplates");
exports.createChannel = async (req, res, next) => {
  try {
    const { channelId, channelName, channelDescription, isPrivate } = parseBody(
      req.body
    );

    const userId = req.user.id;
    const user = await findUser({ _id: userId });

    // Check if this is an update operation
    if (channelId) {
      // Update existing channel
      const existingChannel = await findChannel({ _id: channelId });
      if (!existingChannel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }

      // Check if user has permission to update (is member or admin)
      if (
        !existingChannel.members.includes(userId) &&
        existingChannel.createdBy.toString() !== userId
      ) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have permission to update this channel",
        });
      }

      // Update channel
      const updatedChannel = await updateChannel(
        { _id: channelId },
        {
          channelName,
          channelDescription,
          isPrivate,
        }
      );

      return generateResponse(
        updatedChannel,
        "Channel updated successfully",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Create new channel
    // Add only the creator to the channel
    const channel = await createChannel({
      channelName,
      channelDescription,
      companyId: user.companyId,
      isPrivate,
      createdBy: userId,
      channelToken: generateJoinToken(),
      members: [userId], // Only add creator
    });

    // Auto-create chat conversation for this channel
    await createChatConversation({
      companyId: user.companyId,
      type: "channel",
      channelId: channel._id,
      participantIds: [], // Empty for channel type - members stored in participants array
      participants: [
        {
          userId: userId,
          lastReadAt: null, // Initialize with null - will be set when creator first reads chat
        },
      ],
      createdBy: userId,
    });

    // Create default "task management" tab and add only creator to it
    const taskManagementTab = await createChannelTab({
      channelId: channel._id,
      tabName: "task management",
      isDefault: true,
      members: [userId], // Only add creator
      createdBy: userId,
      companyId: user.companyId,
      isPrivate: false,
    });

    // Add the tab ID to the channel's tabs array
    await updateChannel(
      { _id: channel._id },
      { $push: { tabs: taskManagementTab._id } }
    );

    return generateResponse(
      {
        ...channel.toObject(),
        tabs: [taskManagementTab._id], // Include the tab ID in response
        defaultTab: taskManagementTab,
      },
      "Channel created successfully with default tab",
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

    // Get requesting user details to determine if this is self-joining
    const requestingUser = await findUser({ _id: requestingUserId });
    if (!requestingUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Requesting user not found",
      });
    }

    // Determine if this is a self-join scenario
    // Self-join: user is adding only their own email and is not a channel member
    const isSelfJoin =
      nonDemoEmails.length === 1 &&
      nonDemoEmails[0].toLowerCase() === requestingUser.email.toLowerCase() &&
      !channel?.members?.includes(requestingUserId);

    // Permission check: either user is a channel member OR it's a self-join
    if (!isSelfJoin && !channel?.members?.includes(requestingUserId)) {
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

        // Check if channel has tabs and add users to public tabs
        const channelTabsQuery = [
          {
            $match: {
              channelId: require("mongoose").Types.ObjectId.createFromHexString(
                channel._id.toString()
              ),
            },
          },
        ];

        const channelTabsResult = await getAllTabs({
          query: channelTabsQuery,
          page: 1,
          limit: 100, // Get all tabs (assuming reasonable limit)
          responseKey: "tabs",
        });

        // If channel has tabs, add users to public tabs
        if (channelTabsResult.tabs && channelTabsResult.tabs.length > 0) {
          const publicTabs = channelTabsResult.tabs.filter(
            (tab) => !tab.isPrivate
          );

          if (publicTabs.length > 0) {
            // Add users to all public tabs in parallel
            const tabUpdatePromises = publicTabs.map((tab) =>
              updateChannelTab(
                { _id: tab._id },
                { $addToSet: { members: { $each: usersToAdd } } }
              )
            );

            await Promise.all(tabUpdatePromises);
          }
        }

        // Sync chat conversation participants
        // Add new members to the channel's conversation participants array
        for (const userId of usersToAdd) {
          try {
            await addChannelParticipant(channel._id, userId);
          } catch (participantError) {
            console.error(
              `Failed to add user ${userId} to conversation participants:`,
              participantError
            );
            // Continue with other users even if one fails
          }
        }

        // ========== Create Channel Invitation Notifications ==========
        // Create notifications for each successfully added user
        const io = getIO();
        for (const addedUser of addedUsers) {
          try {
            const notification = await createNotification({
              userId: addedUser._id,
              type: "CHANNEL_INVITATION",
              activityCategory: "invitation",
              title: "Channel invitation",
              message: `${requestingUser.name} added you to ${channel.channelName}`,
              channelId: channel._id,
              channelName: channel.channelName,
              createdBy: requestingUserId,
            });

            // Emit real-time activity update to invited user
            io.to(`user:${addedUser._id}`).emit("activity:new", {
              _id: notification._id,
              type: "CHANNEL_INVITATION",
              activityCategory: "invitation",
              subtitle: `invited to ${channel.channelName}`,
              title: "Channel invitation",
              messagePreview: `${requestingUser.name} added you to ${channel.channelName}`,
              actor: {
                _id: requestingUser._id,
                name: requestingUser.name,
                email: requestingUser.email,
                image: requestingUser.image,
              },
              channelName: channel.channelName,
              timestamp: notification.timestamp,
              isRead: false,
              navigationContext: {
                conversationId: null,
                messageId: null,
                channelId: channel._id,
                projectId: null,
                taskId: null,
                tabId: null,
              },
            });

            // Emit updated unread counts
            await emitUnreadCountsUpdate(addedUser._id.toString(), io);
          } catch (notificationError) {
            console.error(
              `Failed to create invitation notification for user ${addedUser._id}:`,
              notificationError
            );
            // Continue with other notifications even if one fails
          }
        }
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
      isSelfJoin, // Include this info in response for frontend reference
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
      const baseMessage = isSelfJoin
        ? `You joined the channel successfully, but ${errors.length} other users failed to be added`
        : `${addedUsers.length} users added successfully. ${errors.length} users failed to be added`;
      const message = `${baseMessage}${demoNote}.`;
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
      const baseMessage = isSelfJoin
        ? "You joined the channel successfully"
        : "All users added to the channel successfully";
      const message = `${baseMessage}${demoNote}`;
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

        // Check user domain vs company domain
        const userDomain = extractDomainFromEmail(email);
        const isCompanyDomain = userDomain === company.domain;

        // Check if user exists (but don't require it)
        const existingUser = await findUser({ email });

        // If user exists, do validation checks
        if (existingUser) {
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

          // For company domain users, ensure they're part of the company
          if (
            isCompanyDomain &&
            existingUser.companyId.toString() !== channel.companyId.toString()
          ) {
            results.failed.push({
              email,
              reason: "User is not a member of the company",
            });
            continue;
          }
        }

        // Prepare email content
        const subject = `Join ${channel.channelName} channel at ${company.name}`;
        const isGuestInvite = !isCompanyDomain; // Non-company domain users are guests
        const { html, text } = generateChannelInviteEmail({
          channelName: channel.channelName,
          companyName: company.name,
          inviteLink,
          inviterName: inviter.name,
          inviterEmail: inviter.email,
          channelDescription,
          isGuestInvite,
        });

        // Send email
        await Mailer.sendEmail({
          email,
          subject,
          message: text,
          html: html,
          replyTo: inviter.email,
        });

        // Determine invite type based on user status and domain
        let inviteType;
        if (isCompanyDomain) {
          inviteType = existingUser
            ? "company_existing_user"
            : "company_new_user";
        } else {
          inviteType = existingUser
            ? "external_existing_user"
            : "external_new_user";
        }

        results.successful.push({
          email,
          inviteType,
          inviteLink,
          isCompanyDomain,
          isGuestInvite,
          userExists: !!existingUser,
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

    // Add user to chat conversation participants
    const { addChannelParticipant } = require("../models/chatConversationModel");
    await addChannelParticipant(channel._id, currentUserId);

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

    // ========== Create Channel Invitation Notification ==========
    // Create notification for user who joined via invite link
    try {
      // Find the user who created the invite slot (inviter)
      const inviter = inviteSlot.createdBy
        ? await findUser({ _id: inviteSlot.createdBy })
        : null;

      const notification = await createNotification({
        userId: currentUserId,
        type: "CHANNEL_INVITATION",
        activityCategory: "invitation",
        title: "Channel invitation",
        message: inviter
          ? `${inviter.name} invited you to ${channel.channelName}`
          : `You joined ${channel.channelName}`,
        channelId: channel._id,
        channelName: channel.channelName,
        createdBy: inviteSlot.createdBy || currentUserId,
      });

      // Emit real-time activity update
      const io = getIO();
      const actor = inviter || currentUser;

      io.to(`user:${currentUserId}`).emit("activity:new", {
        _id: notification._id,
        type: "CHANNEL_INVITATION",
        activityCategory: "invitation",
        subtitle: `invited to ${channel.channelName}`,
        title: "Channel invitation",
        messagePreview: inviter
          ? `${inviter.name} invited you to ${channel.channelName}`
          : `You joined ${channel.channelName}`,
        actor: {
          _id: actor._id,
          name: actor.name,
          email: actor.email,
          image: actor.image,
        },
        channelName: channel.channelName,
        timestamp: notification.timestamp,
        isRead: false,
        navigationContext: {
          conversationId: null,
          messageId: null,
          channelId: channel._id,
          projectId: null,
          taskId: null,
          tabId: null,
        },
      });

      // Emit updated unread counts
      await emitUnreadCountsUpdate(currentUserId.toString(), io);
    } catch (notificationError) {
      console.error(
        `Failed to create invitation notification for user ${currentUserId}:`,
        notificationError
      );
      // Continue even if notification fails
    }

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

// Edit channel details
exports.editChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { channelName, channelDescription } = parseBody(req.body);
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You must be a member of the channel to edit it",
      });
    }

    // Prepare update data (only include provided fields)
    const updateData = {
      updatedAt: new Date(),
    };

    if (channelName !== undefined) updateData.channelName = channelName;
    if (channelDescription !== undefined)
      updateData.channelDescription = channelDescription;

    // Update the channel
    const updatedChannel = await updateChannel({ _id: channelId }, updateData);

    return generateResponse(
      updatedChannel,
      "Channel updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in editChannel:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to update channel",
    });
  }
};

// Toggle channel archive status
exports.toggleChannelArchive = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Security check: user must be from same company
    if (channel.companyId.toString() !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only archive channels from your own company",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You must be a member of the channel to archive it",
      });
    }

    // Toggle archive status - handle case where isArchived doesn't exist on older channels
    const currentArchiveStatus = channel.isArchived || false;
    const newArchiveStatus = !currentArchiveStatus;

    // Update the channel
    const updatedChannel = await updateChannel(
      { _id: channelId },
      {
        isArchived: newArchiveStatus,
        updatedAt: new Date(),
      }
    );

    const action = newArchiveStatus ? "archived" : "unarchived";
    return generateResponse(
      {
        channel: updatedChannel,
        isArchived: newArchiveStatus,
        action,
      },
      `Channel ${action} successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in toggleChannelArchive:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to toggle channel archive status",
    });
  }
};

// Get archived channels for user
exports.getArchivedChannels = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const userId = req.user.id;

    const query = getArchivedChannelsQuery(userId);
    const channels = await getAllChannelsDetails({
      query,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 10,
      responseKey: "channels",
    });

    return generateResponse(
      channels,
      "Archived channels fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getArchivedChannels:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch archived channels",
    });
  }
};

// Leave channel - remove user from channel and all related tabs
exports.leaveChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Security check: user must be from same company
    if (channel.companyId.toString() !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only leave channels from your own company",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "You are not a member of this channel",
      });
    }

    // Check if user is the creator of the channel
    if (channel.createdBy.toString() === userId) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Channel creator cannot leave the channel. Please transfer ownership or delete the channel.",
      });
    }

    // Remove user from channel members
    const updatedChannel = await updateChannel(
      { _id: channelId },
      {
        $pull: { members: userId },
        updatedAt: new Date(),
      }
    );

    if (!updatedChannel) {
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Failed to leave channel",
      });
    }

    // Remove user from chat conversation participants
    const { removeChannelParticipant } = require("../models/chatConversationModel");
    await removeChannelParticipant(channelId, userId);

    // Get all tabs for this channel and remove user from their members arrays
    const channelTabsQuery = [
      {
        $match: {
          channelId: require("mongoose").Types.ObjectId.createFromHexString(channelId),
        },
      },
    ];

    const channelTabsResult = await getAllTabs({
      query: channelTabsQuery,
      page: 1,
      limit: 100, // Get all tabs (assuming reasonable limit)
      responseKey: "tabs",
    });

    if (channelTabsResult.tabs && channelTabsResult.tabs.length > 0) {
      // Remove user from all channel tabs in parallel
      const tabUpdatePromises = channelTabsResult.tabs.map((tab) =>
        updateChannelTab(
          { _id: tab._id },
          { 
            $pull: { members: userId },
            updatedAt: new Date(),
          }
        )
      );

      await Promise.all(tabUpdatePromises);
    }

    return generateResponse(
      {
        channelId: channel._id,
        channelName: channel.channelName,
        leftAt: new Date(),
        tabsUpdated: channelTabsResult.tabs ? channelTabsResult.tabs.length : 0,
      },
      "Successfully left the channel",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in leaveChannel:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to leave channel",
    });
  }
};

/**
 * Upload files to channel
 * POST /api/channels/:channelId/files
 */
exports.uploadFilesToChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { files } = parseBody(req.body);
    const userId = req.user.id;

    // Validate required fields
    if (!files || !Array.isArray(files) || files.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "files array is required and must not be empty",
      });
    }

    // Verify channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    const isMember = channel.members.some(
      (memberId) => memberId.toString() === userId
    );
    if (!isMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Prepare files data with metadata
    const filesData = files.map((file) => {
      let url = file.url;
      // Normalize full URLs to relative paths for consistency with task attachments
      if (url && url.startsWith("http")) {
        try {
          const urlObj = new URL(url);
          url = urlObj.pathname;
        } catch {
          // If URL parsing fails, use as-is
        }
      }

      return {
        url,
        fileName: file.fileName || null,
        fileSize: file.fileSize || null,
        mimeType: file.mimeType || null,
        uploadedBy: userId,
        uploadedAt: new Date(),
      };
    });

    // Add files to channel
    const updatedChannel = await addFilesToChannel(channelId, filesData);

    return generateResponse(
      {
        channelId: updatedChannel._id,
        filesAdded: filesData.length,
        totalFiles: updatedChannel.files.length,
        files: filesData,
      },
      "Files uploaded successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in uploadFilesToChannel:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to upload files",
    });
  }
};

/**
 * Get channel files with type filtering
 * GET /api/channels/:channelId/files
 */
exports.getChannelFiles = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { type = "all", page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    // Verify channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    const isMember = channel.members.some(
      (memberId) => memberId.toString() === userId
    );
    if (!isMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Build aggregation query
    const query = getChannelFilesQuery(channelId, type);

    // Get paginated files
    const result = await getAllChannelsDetails({
      query,
      page: parseInt(page),
      limit: parseInt(limit),
      responseKey: "files",
    });

    return generateResponse(
      {
        ...result,
        filter: {
          type,
          channelId,
          channelName: channel.channelName,
        },
      },
      "Files retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getChannelFiles:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to retrieve files",
    });
  }
};

/**
 * Delete file from channel
 * DELETE /api/channels/:channelId/files/:fileId
 */
exports.deleteChannelFile = async (req, res, next) => {
  try {
    const { channelId, fileId } = req.params;
    const userId = req.user.id;

    // Verify channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    const isMember = channel.members.some(
      (memberId) => memberId.toString() === userId
    );
    if (!isMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Verify file exists in channel
    const fileExists = channel.files.some(
      (file) => file._id.toString() === fileId
    );

    if (!fileExists) {
      // Check if it's a task attachment in this channel
      const task = await findTask({
        channelId,
        isActive: true,
        "attachments._id": new mongoose.Types.ObjectId(fileId),
      });

      if (!task) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "File not found in this channel",
        });
      }

      // Remove attachment from task
      await updateTask(
        { _id: task._id },
        { $pull: { attachments: { _id: new mongoose.Types.ObjectId(fileId) } } }
      );

      return generateResponse(
        { channelId, fileId, source: "task", deletedAt: new Date() },
        "File deleted successfully",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Remove file from channel
    const updatedChannel = await removeFileFromChannel(channelId, fileId);

    return generateResponse(
      {
        channelId: updatedChannel._id,
        fileId,
        totalFiles: updatedChannel.files.length,
        deletedAt: new Date(),
      },
      "File deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteChannelFile:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to delete file",
    });
  }
};

/**
 * Remove a user from channel (by creator or company admin)
 * Also removes user from all channel tabs and chat conversation
 */
exports.removeUserFromChannel = async (req, res, next) => {
  try {
    const { userId: targetUserId, channelId } = parseBody(req.body);
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;

    // 1. Validate target user exists
    const targetUser = await findUser({ _id: targetUserId });
    if (!targetUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // 2. Validate channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // 3. Verify requesting user has access to this channel's company
    const requestingUser = await findUser({ _id: requestingUserId });
    if (channel.companyId.toString() !== requestingUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this channel",
      });
    }

    // 4. Check permission: Only channel creator or company admin can remove
    const isChannelCreator = channel.createdBy.toString() === requestingUserId;
    const isCompanyAdmin = requestingUserRole === ROLES.ADMIN;

    if (!isChannelCreator && !isCompanyAdmin) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only channel creator or company admin can remove members",
      });
    }

    // 5. Cannot remove the channel creator
    if (channel.createdBy.toString() === targetUserId) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Cannot remove the channel creator",
      });
    }

    // 6. Check if target user is a member
    if (!channel.members.some(m => m.toString() === targetUserId)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User is not a member of this channel",
      });
    }

    // 7. Remove from channel members
    const updatedChannel = await updateChannel(
      { _id: channelId },
      {
        $pull: { members: targetUserId },
        updatedAt: new Date(),
      }
    );

    if (!updatedChannel) {
      return next({
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        message: "Failed to remove user from channel",
      });
    }

    // 8. Remove from chat conversation participants
    const { removeChannelParticipant } = require("../models/chatConversationModel");
    await removeChannelParticipant(channelId, targetUserId);

    // 9. Get all tabs for this channel and remove user from their members arrays
    const channelTabsQuery = [
      {
        $match: {
          channelId: require("mongoose").Types.ObjectId.createFromHexString(channelId),
        },
      },
    ];

    const channelTabsResult = await getAllTabs({
      query: channelTabsQuery,
      page: 1,
      limit: 100,
      responseKey: "tabs",
    });

    if (channelTabsResult.tabs && channelTabsResult.tabs.length > 0) {
      const tabUpdatePromises = channelTabsResult.tabs.map((tab) =>
        updateChannelTab(
          { _id: tab._id },
          {
            $pull: { members: targetUserId },
            updatedAt: new Date(),
          }
        )
      );
      await Promise.all(tabUpdatePromises);
    }

    return generateResponse(
      {
        channel: updatedChannel,
        removedUserId: targetUserId,
        tabsUpdated: channelTabsResult.tabs ? channelTabsResult.tabs.length : 0,
      },
      "User removed from channel successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in removeUserFromChannel:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to remove user from channel",
    });
  }
};

/**
 * Determine attachment type from MIME type for chat messages
 */
const determineAttachmentType = (mimeType) => {
  if (!mimeType) return "document";

  if (mimeType.startsWith("image/")) {
    return mimeType === "image/gif" ? "gif" : "image";
  }
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
};

/**
 * Create a chat message with shared file attachment
 */
const createSharedFileMessage = async ({
  conversation,
  file,
  attachmentMeta,
  message,
  userId,
  user,
  io,
}) => {
  // Build TipTap contentDoc
  let contentDoc;
  if (message && message.trim()) {
    contentDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: message.trim() }],
        },
      ],
    };
  } else {
    // Empty message with just attachment
    contentDoc = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  // Create the message
  const chatMessage = await createChatMessage({
    companyId: conversation.companyId,
    conversationId: conversation._id,
    authorId: userId,
    contentDoc,
    contentText: message?.trim() || "",
    attachmentsUrls: [file.url],
    attachmentsMeta: [attachmentMeta],
    links: [],
  });

  // Update conversation last message
  const previewText = message?.trim() || `📎 ${file.fileName || "File"}`;
  await updateLastMessage(conversation._id, previewText, chatMessage.createdAt);

  // Populate author for socket emission
  const populatedMessage = {
    ...chatMessage.toObject(),
    author: {
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
    },
  };

  // Emit to conversation room
  io.to(`conversation:${conversation._id}`).emit("chat:message:new", {
    message: populatedMessage,
  });

  return chatMessage;
};

/**
 * Share a channel file to chats or task
 * POST /api/channels/:channelId/files/share
 */
exports.shareChannelFile = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { fileId, shareToClientChat, shareToTeamChat, taskId, message } =
      parseBody(req.body);
    const userId = req.user.id;

    // 1. Verify channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // 2. Verify user is a member of the channel
    const isMember = channel.members.some(
      (memberId) => memberId.toString() === userId
    );
    if (!isMember) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // 3. Find the file in channel.files
    const file = channel.files.find((f) => f._id.toString() === fileId);
    if (!file) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "File not found in this channel",
      });
    }

    // 4. Get user details for message creation
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const io = getIO();
    const results = {
      clientChat: null,
      teamChat: null,
      task: null,
    };

    // 5. Build attachment metadata for chat messages
    const attachmentMeta = {
      url: file.url,
      type: determineAttachmentType(file.mimeType),
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
    };

    // 6. Share to Client Chat
    if (shareToClientChat) {
      const clientConvo = await findChatConversation({
        channelId: channel._id,
        type: "client",
      });

      if (clientConvo) {
        const chatMessage = await createSharedFileMessage({
          conversation: clientConvo,
          file,
          attachmentMeta,
          message,
          userId,
          user,
          io,
        });

        results.clientChat = {
          conversationId: clientConvo._id,
          messageId: chatMessage._id,
        };
      }
    }

    // 7. Share to Team Chat
    if (shareToTeamChat) {
      const teamConvo = await findChatConversation({
        channelId: channel._id,
        type: "channel",
      });

      if (teamConvo) {
        const chatMessage = await createSharedFileMessage({
          conversation: teamConvo,
          file,
          attachmentMeta,
          message,
          userId,
          user,
          io,
        });

        results.teamChat = {
          conversationId: teamConvo._id,
          messageId: chatMessage._id,
        };
      }
    }

    // 8. Add to Task Attachments
    if (taskId) {
      const task = await findTask({ _id: taskId });

      if (!task) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Task not found",
        });
      }

      // Verify task belongs to this channel
      let taskChannelId = task.channelId?.toString();
      if (task.projectId) {
        const project = await findProject({ _id: task.projectId });
        if (project) {
          taskChannelId = project.channelId?.toString();
        }
      }

      if (taskChannelId !== channelId) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "Task does not belong to this channel",
        });
      }

      // Add attachment to task
      const taskAttachment = {
        url: file.url,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        uploadedBy: userId,
        uploadedAt: new Date(),
        source: "channel_file",
      };

      const updatedTask = await updateTask(
        { _id: taskId },
        {
          $push: { attachments: taskAttachment },
          updatedAt: new Date(),
          $inc: { version: 1 },
        },
        { new: true }
      );

      // Create activity for task attachment
      await handleAttachmentsActivity({
        attachments: updatedTask.attachments,
        userName: user.name || user.email,
        task: updatedTask,
        projectId: task.projectId,
        channelId: task.channelId || channelId,
        userId,
      });

      // Emit real-time update to task room
      io.to(`task:${taskId}`).emit("task-update-response", {
        success: true,
        taskId,
        field: "attachments",
        newValue: updatedTask.attachments,
        version: updatedTask.version,
      });

      // Emit to channel room for activity feed
      io.to(`channel:${channelId}`).emit("tab-activity", {
        type: "TASK_UPDATED",
        task: updatedTask,
        field: "attachments",
        updatedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        timestamp: new Date(),
      });

      results.task = {
        taskId: task._id,
        attachmentIndex: updatedTask.attachments.length - 1,
      };
    }

    return generateResponse(
      {
        sharedTo: results,
        file: {
          url: file.url,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
        },
      },
      "File shared successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in shareChannelFile:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to share file",
    });
  }
};

/**
 * Get all tasks for a channel (for dropdown)
 * Returns only _id and title, regardless of project or status
 * GET /api/channels/:channelId/tasks/dropdown
 */
exports.getChannelTasksDropdown = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;

    // Verify channel exists
    const channel = await findChannel({ _id: channelId, isActive: true });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Verify user is a member of the channel
    if (!channel.members.some((m) => m.toString() === userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Get all active tasks for this channel (regardless of project/status)
    const tasks = await aggregateTasks([
      {
        $match: {
          channelId: new mongoose.Types.ObjectId(channelId),
          isActive: true,
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
        },
      },
      {
        $sort: { title: 1 },
      },
    ]);

    return generateResponse(
      { tasks },
      "Tasks retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getChannelTasksDropdown:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to retrieve tasks",
    });
  }
};
