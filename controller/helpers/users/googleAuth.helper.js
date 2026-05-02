"use strict";

const { generateResponse, setRefreshTokenCookie } = require("../../../utils");
const { STATUS_CODES, ROLES, AUTH_PROVIDERS } = require("../../../utils/constants");
const {
  calculateRefreshTokenExpiry,
} = require("../../../utils/tokenConstants");
const {
  createUser,
  generateToken,
  generateRefreshToken,
  findUser,
  addRefreshToken,
  updateUser,
} = require("../../../models/userModel");
const { createCompany } = require("../../../models/companyModel");
const { createManyInviteSlots, findAvailableInviteSlot, updateInviteSlot } = require("../../../models/inviteSlotModel");
const { generateJoinToken, createInviteSlots } = require("./signup.helper");
const { extractDeviceInfo } = require("../../../utils/deviceDetection");
const Mailer = require("../../../utils/mailer");
const {
  generateRegistrationSuccessEmail,
} = require("../../../utils/templates/registrationSuccessTemplate");

/**
 * Create and store refresh token, return access + refresh tokens.
 * Reuses the same pattern as login.helper.js createAndStoreRefreshToken.
 */
const createAndStoreRefreshToken = async (user, req) => {
  const { token: accessToken, jti } = generateToken(user);
  const refreshToken = generateRefreshToken(user);

  const deviceInfo = await extractDeviceInfo(req);
  const expiresAt = calculateRefreshTokenExpiry();

  const refreshTokenData = {
    token: refreshToken,
    deviceInfo,
    currentAccessTokenJti: jti,
    expiresAt,
  };

  await addRefreshToken(user._id, refreshTokenData);

  return { accessToken, refreshToken };
};

/**
 * Handle login for an existing Google user.
 */
exports.handleGoogleLogin = async (user, req, res, next) => {
  try {
    // Check if user account is active
    if (!user.isActive) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Account is inactive. Please wait for admin approval.",
      });
    }

    // Check account expiry
    if (user.expiresAt && new Date() > user.expiresAt) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Your account has expired. Please contact support for renewal.",
      });
    }

    // Fetch clean user object
    const cleanUser = await findUser({ _id: user._id }).select("-refreshTokens");

    const { accessToken, refreshToken } = await createAndStoreRefreshToken(
      cleanUser,
      req
    );

    setRefreshTokenCookie(res, refreshToken);

    return generateResponse(
      {
        user: cleanUser,
        accessToken,
      },
      "User logged in successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in handleGoogleLogin:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process Google login",
    });
  }
};

/**
 * Handle admin signup — create user + company (no existing company for this domain).
 */
exports.handleGoogleAdminSignup = async (
  googlePayload,
  accountName,
  domain,
  howDidYouHearAboutUs,
  isConsumerDomain,
  req,
  res,
  next
) => {
  try {
    // Create user with Google auth provider, no password
    let user = await createUser({
      name: googlePayload.name,
      email: googlePayload.email,
      authProvider: AUTH_PROVIDERS.GOOGLE,
      googleId: googlePayload.googleId,
      image: googlePayload.picture,
      role: ROLES.ADMIN,
    });

    // Create company
    const company = await createCompany({
      name: accountName,
      domain,
      joinToken: generateJoinToken(),
      adminUser: user._id,
      howDidYouHearAboutUs,
      isConsumerDomain: isConsumerDomain || false,
    });

    // Create invite slots
    await createInviteSlots(company._id, createManyInviteSlots);

    // Update user with companyId
    user = await updateUser({ _id: user._id }, { companyId: company._id });

    // Fetch clean user object
    const cleanUser = await findUser({ _id: user._id }).select("-refreshTokens");

    const { accessToken, refreshToken } = await createAndStoreRefreshToken(
      cleanUser,
      req
    );

    setRefreshTokenCookie(res, refreshToken);

    // Send welcome email (silent failure)
    try {
      const emailTemplate = generateRegistrationSuccessEmail({
        userName: googlePayload.name,
        companyName: accountName,
        loginLink: `${process.env.FRONTEND_URL}/login`,
      });

      await Mailer.sendEmail({
        email: googlePayload.email,
        subject: "Welcome to Boarddd!",
        message: emailTemplate.text,
        html: emailTemplate.html,
      });
    } catch (emailError) {
      console.error("Failed to send registration email:", emailError);
    }

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
    console.error("Error in handleGoogleAdminSignup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process Google admin signup",
    });
  }
};

/**
 * Handle domain signup — join an existing company.
 */
exports.handleGoogleDomainSignup = async (
  googlePayload,
  company,
  req,
  res,
  next
) => {
  try {
    const willBeActive = company.automaticSignups === true;
    let availableSlot = null;

    // Only consume a slot if user will be active
    if (willBeActive) {
      availableSlot = await findAvailableInviteSlot({
        companyId: company._id,
        isGuestInviteSlot: false,
      });

      if (!availableSlot) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "No available company invite slots for domain signup",
        });
      }
    }

    // Create user
    const user = await createUser({
      name: googlePayload.name,
      email: googlePayload.email,
      authProvider: AUTH_PROVIDERS.GOOGLE,
      googleId: googlePayload.googleId,
      image: googlePayload.picture,
      role: ROLES.EMPLOYEE,
      companyId: company._id,
      isActive: willBeActive,
    });

    // Mark slot as used if applicable
    if (willBeActive && availableSlot) {
      await updateInviteSlot(
        { _id: availableSlot._id },
        {
          used: true,
          usedBy: user._id,
          usedAt: new Date(),
          inviteType: "company",
        }
      );
    }

    // Fetch clean user object
    const cleanUser = await findUser({ _id: user._id }).select("-refreshTokens");

    const { accessToken, refreshToken } = await createAndStoreRefreshToken(
      cleanUser,
      req
    );

    setRefreshTokenCookie(res, refreshToken);

    const successMessage = willBeActive
      ? "User account created and activated successfully."
      : "User account created successfully. Waiting for admin approval.";

    return generateResponse(
      {
        user: cleanUser,
        accessToken,
      },
      successMessage,
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in handleGoogleDomainSignup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process Google domain signup",
    });
  }
};
