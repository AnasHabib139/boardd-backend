"use strict";

const bcrypt = require("bcrypt");
const { STATUS_CODES } = require("../utils/constants");
const {
  generateResponse,
  parseBody,
  setRefreshTokenCookie,
  extractDomainFromEmail,
} = require("../utils");
const { calculateRefreshTokenExpiry } = require("../utils/tokenConstants");
const {
  findUser,
  createUser,
  generateToken,
  generateRefreshToken,
  updateUser,
  getAllUsers,
  addRefreshToken,
  removeUser,
  findManyUsers,
} = require("../models/userModel");
const { createCompany, findCompany } = require("../models/companyModel");
const { createManyInviteSlots, findInviteSlot, updateInviteSlot, findManyInviteSlots } = require("../models/inviteSlotModel");
const {
  hashPassword,
  generateJoinToken,
  createInviteSlots,
} = require("./helpers/users/signup.helper");
const { getCompanyUsersQuery } = require("./queries/userQueries");
const { extractDeviceInfo } = require("../utils/deviceDetection");
const {
  determineLoginStrategy,
  handleDomainFlow,
  handleRegularFlow,
  handlePublicFlow,
  handleInviteFlow,
  handleGuestFlow,
} = require("./helpers/users/login.flow");
const { cleanupUserReferences } = require("./helpers/users/deleteUser.helper");

exports.signup = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      accountName,
      role,
      howDidYouHearAboutUs,
    } = parseBody(req.body);

    // Check if user exists
    const existingUser = await findUser({ email });
    if (existingUser) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "User already exists",
      });
    }

    // Check if company exists
    const domain = extractDomainFromEmail(email);
    const existingCompany = await findCompany({ domain });
    if (existingCompany) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "Company already exists",
      });
    }

    // Create user with hashed password
    const hashedPassword = await hashPassword(password);
    let user = await createUser({
      name,
      email,
      password: hashedPassword,
      role,
    });

    // Create company
    const company = await createCompany({
      name: accountName,
      domain,
      joinToken: generateJoinToken(),
      howDidYouHearAboutUs,
      adminUser: user._id,
    });

    // Create invite slots
    await createInviteSlots(company._id, createManyInviteSlots);

    // Update user with company
    user = await updateUser({ _id: user._id }, { companyId: company._id });

    // Fetch clean user object without password and refresh tokens for response
    const cleanUser = await findUser({ _id: user._id }).select(
      "-refreshTokens"
    );

    // Generate both tokens (now returns { token, jti })
    const { token: accessToken, jti } = generateToken(cleanUser);
    const refreshToken = generateRefreshToken(cleanUser);

    // Get device info with location (async)
    const deviceInfo = await extractDeviceInfo(req);

    // Calculate expiration date (30 days from now)
    const expiresAt = calculateRefreshTokenExpiry();

    // Create refresh token data with JTI
    const refreshTokenData = {
      token: refreshToken,
      deviceInfo,
      currentAccessTokenJti: jti, // Store JTI for blacklisting
      expiresAt,
    };

    // Add refresh token to user's array
    await addRefreshToken(user._id, refreshTokenData);

    // Set refresh token as httpOnly cookie
    setRefreshTokenCookie(res, refreshToken);

    return generateResponse(
      {
        user: cleanUser,
        company,
        accessToken,
      },
      "Admin and company created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.log(error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

exports.login = async (req, res, next) => {
  try {
    const { name, email, password } = parseBody(req.body);
    const { token, joinToken } = req?.query ?? {};

    // Strategy pattern for different login flows
    const loginStrategy = await determineLoginStrategy(token, joinToken, email);

    // Execute the appropriate strategy
    switch (loginStrategy.type) {
      case "GUEST_SIGNUP":
        return await handleGuestFlow(
          loginStrategy.data,
          { name, email, password },
          req,
          res,
          next
        );

      case "INVITE_SIGNUP":
        return await handleInviteFlow(
          loginStrategy.data,
          { name, email, password },
          req,
          res,
          next
        );

      case "PUBLIC_SIGNUP":
        return await handlePublicFlow(
          loginStrategy.data,
          { name, email, password },
          req,
          res,
          next
        );

      case "REGULAR_LOGIN":
        // Check account expiry before login
        const user = loginStrategy.data.user;
        if (user.expiresAt && new Date() > user.expiresAt) {
          return next({
            statusCode: STATUS_CODES.UNAUTHORIZED,
            message:
              "Your account has expired. Please contact support for renewal.",
          });
        }

        return await handleRegularFlow(
          loginStrategy.data,
          { email, password },
          req,
          res,
          next
        );

      case "DOMAIN_SIGNUP":
        return await handleDomainFlow(
          loginStrategy.data,
          { name, email, password },
          req,
          res,
          next
        );

      case "INVALID_TOKEN":
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Invalid or expired invite token",
        });

      default:
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message:
            "Invalid login request. No matching authentication method found.",
        });
    }
  } catch (error) {
    console.error("Login error:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "An unexpected error occurred during login",
    });
  }
};

// get users of particular company with matching name
exports.getUsersOfCompany = async (req, res, next) => {
  const { email, page, limit } = req.query;

  try {
    const userId = req.user.id;
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const company = await findCompany({ _id: user.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Get the aggregation query from userQueries
    const queryArray = getCompanyUsersQuery(
      company._id.toString(),
      userId,
      email
    );

    if (email && email.trim() !== "") {
      console.log("Searching for emails containing:", email.trim());
    }

    const users = await getAllUsers({
      query: queryArray,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "users",
    });

    return generateResponse(
      users,
      "Users fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUsersOfCompany:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get user profile
 */
exports.getUserProfile = async (req, res, next) => {
  try {
    const userId = req?.user?.id;

    // Find user with all data except password and refresh tokens
    const user = await findUser({ _id: userId }).select("-password -refreshTokens");
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    return generateResponse(
      {
        user,
      },
      "User profile fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getUserProfile:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Update user settings and profile
 */
exports.updateUserSettings = async (req, res, next) => {
  try {
    const userId = req?.user?.id;
    const {
      name,
      nickname,
      title,
      designation,
      description,
      oldPassword,
      newPassword,
      theme,
      localization,
      notifications,
      privacy,
      profile,
      appearance,
      image,
      coverImage,
      completeName,
      gender,
      contact,
      address,
      dob
    } = req.validatedBody;

    // Find current user with password for validation
    const user = await findUser({ _id: userId }).select("+password");
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Prepare update data
    const updateData = {};

    // Update basic profile fields
    if (name !== undefined) {
      updateData.name = name;
    }
    
    if (nickname !== undefined) {
      updateData.nickname = nickname;
    }

    if (title !== undefined) {
      updateData.title = title;
    }

    if (designation !== undefined) {
      updateData.designation = designation;
    }

    if (description !== undefined) {
      updateData.description = description;
    }

    if (image !== undefined) {
      updateData.image = image;
    }

    if (coverImage !== undefined) {
      updateData.coverImage = coverImage;
    }

    if (completeName !== undefined) {
      if (completeName.firstName !== undefined) {
        updateData["completeName.firstName"] = completeName.firstName;
      }
      if (completeName.lastName !== undefined) {
        updateData["completeName.lastName"] = completeName.lastName;
      }
    }

    if (gender !== undefined) {
      updateData.gender = gender;
    }

    if (contact !== undefined) {
      if (contact.code !== undefined) {
        updateData["contact.code"] = contact.code;
      }
      if (contact.number !== undefined) {
        updateData["contact.number"] = contact.number;
      }
    }

    if (address !== undefined) {
      updateData.address = address;
    }

    if (dob !== undefined) {
      updateData.dob = dob;
    }

    // Handle password update
    if (newPassword) {
      // Validate old password
      if (!oldPassword) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Old password is required when updating password",
        });
      }

      // Check if old password matches current password
      const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
      if (!isOldPasswordValid) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Old password is incorrect",
        });
      }

      // Check if new password is same as old password
      if (oldPassword === newPassword) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "New password cannot be the same as old password",
        });
      }

      // Hash and set new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      updateData.password = hashedNewPassword;
    }

    // Update settings (using dot notation for nested updates)
    if (theme) {
      if (theme.color !== undefined) {
        updateData["settings.theme.color"] = theme.color;
      }
    }

    if (localization) {
      if (localization.language !== undefined) {
        updateData["settings.localization.language"] = localization.language;
      }
      if (localization.timezone !== undefined) {
        updateData["settings.localization.timezone"] = localization.timezone;
      }
      if (localization.timeFormat !== undefined) {
        updateData["settings.localization.timeFormat"] = localization.timeFormat;
      }
      if (localization.dateFormat !== undefined) {
        updateData["settings.localization.dateFormat"] = localization.dateFormat;
      }
    }

    if (notifications) {
      if (notifications.email !== undefined) {
        updateData["settings.notifications.email"] = notifications.email;
      }
      if (notifications.push !== undefined) {
        updateData["settings.notifications.push"] = notifications.push;
      }
      if (notifications.desktop !== undefined) {
        updateData["settings.notifications.desktop"] = notifications.desktop;
      }
    }

    if (privacy) {
      if (privacy.profileVisibility !== undefined) {
        updateData["settings.privacy.profileVisibility"] = privacy.profileVisibility;
      }
    }

    if (profile) {
      if (profile.showJobTitleInProfile !== undefined) {
        updateData["settings.profile.showJobTitleInProfile"] = profile.showJobTitleInProfile;
      }
    }

    if (appearance) {
      if (appearance.mode !== undefined) {
        updateData["settings.appearance.mode"] = appearance.mode;
      }
      if (appearance.backgroundLogo !== undefined) {
        updateData["settings.appearance.backgroundLogo"] = appearance.backgroundLogo;
      }
    }

    // Update user
    const updatedUser = await updateUser(
      { _id: userId },
      updateData,
      { new: true }
    ).select("-password -refreshTokens");

    return generateResponse(
      {
        user: updatedUser,
        message: "User settings updated successfully"
      },
      "User settings updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateUserSettings:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete user account and free up slot
 */
exports.deleteUserAccount = async (req, res, next) => {
  try {
    const userId = req?.user?.id;

    // Find current user with all data
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const companyId = user.companyId;

    // Find company to validate
    const company = await findCompany({ _id: companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    // Check if user is admin - prevent deletion
    if (company.adminUser.toString() === userId) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Admin cannot delete their own account. Transfer admin rights first.",
      });
    }

    // Count current users in company to understand slot usage
    const companyUsers = await findManyUsers({ 
      companyId: companyId,
      _id: { $ne: userId } // Exclude current user from count
    });

    // Determine slot type based on user role and account type
    const isGuestUser = user.role === "guest" || user.expiresAt !== null;
    const slotType = isGuestUser ? "guest" : "company";

    console.log(`Deleting ${slotType} user: ${user.email} from company: ${company.name}`);
    console.log(`Remaining users after deletion: ${companyUsers.length}`);

    // COMPREHENSIVE DATA CLEANUP - Remove user references across entire database
    console.log(`🧹 Starting comprehensive data cleanup...`);
    const cleanupResults = await cleanupUserReferences(userId, companyId);

    // Find a used slot of the appropriate type to free up
    const slotToFree = await findInviteSlot({
      companyId: companyId,
      used: true,
      inviteType: slotType,
      isGuestInviteSlot: isGuestUser
    });

    if (slotToFree) {
      // Free up the slot - reset it to available state
      await updateInviteSlot(
        { _id: slotToFree._id },
        {
          used: false,
          reserved: false,
          reservedFor: null,
          reservedRole: null,
          reservedAt: null,
        }
      );
      console.log(`Freed up ${slotType} slot ${slotToFree.slot} for company ${company.name}`);
    } else {
      console.log(`Warning: No used ${slotType} slot found to free up for company ${company.name}`);
    }

    // Delete the user account (final step after cleanup)
    await removeUser(userId);
    console.log(`🗑️ User account deleted successfully`);

    // Calculate remaining slot availability for response
    const availableCompanySlots = await findManyInviteSlots({ 
      companyId: companyId, 
      used: false, 
      reserved: false,
      inviteType: "company",
      isGuestInviteSlot: false 
    });

    const availableGuestSlots = await findManyInviteSlots({ 
      companyId: companyId, 
      used: false, 
      reserved: false,
      inviteType: "guest",
      isGuestInviteSlot: true 
    });

    return generateResponse(
      {
        message: "Account deleted successfully",
        deletedUser: {
          id: userId,
          email: user.email,
          role: user.role,
          accountType: slotType
        },
        slotInfo: {
          slotFreed: !!slotToFree,
          slotType: slotType,
          slotNumber: slotToFree?.slot || null,
          remainingUsers: companyUsers.length,
          availableSlots: {
            company: availableCompanySlots.length,
            guest: availableGuestSlots.length
          }
        },
        dataCleanup: {
          ownership: cleanupResults.ownership,
          assignments: cleanupResults.assignments,
          personalData: cleanupResults.personalData,
          errors: cleanupResults.errors,
          totalOperations: Object.values(cleanupResults.ownership).reduce((sum, count) => sum + count, 0) +
                          Object.values(cleanupResults.assignments).reduce((sum, count) => sum + count, 0) +
                          Object.values(cleanupResults.personalData).reduce((sum, count) => sum + count, 0)
        }
      },
      "Account and all related data deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );

  } catch (error) {
    console.error("Error in deleteUserAccount:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
