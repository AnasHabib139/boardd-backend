"use strict";

const crypto = require("crypto");
const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser, updateUser } = require("../models/userModel");
const {
  createPasswordReset,
  findPasswordReset,
  findLatestPasswordReset,
  markPasswordResetAsUsed,
  incrementAttempts,
  isExpired,
  hasExceededAttempts,
} = require("../models/passwordResetModel");
const { hashPassword, comparePassword } = require("./helpers/users/signup.helper");
const Mailer = require("../utils/mailer");
const {
  generatePasswordResetEmail,
} = require("../utils/templates/passwordResetTemplate");

/**
 * Unified forgot password controller
 * Handles three steps based on request body:
 * 1. { email } - Send reset code
 * 2. { email, code } - Verify code
 * 3. { email, code, newPassword } - Reset password
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email, code, newPassword } = parseBody(req.body);

    if (!email) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Email is required",
      });
    }

    // Check if user exists
    const user = await findUser({ email: email.toLowerCase() });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Step 3: Reset password (email + code + newPassword)
    if (email && code && newPassword) {
      return await handlePasswordReset(email, code, newPassword, res, next);
    }

    // Step 2: Verify code (email + code)
    if (email && code && !newPassword) {
      return await handleCodeVerification(email, code, res, next);
    }

    // Step 1: Send reset code (email only)
    if (email && !code && !newPassword) {
      return await handleSendResetCode(email, user, res, next);
    }

    // Invalid combination
    return next({
      statusCode: STATUS_CODES.BAD_REQUEST,
      message: "Invalid request parameters",
    });
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Step 1: Send reset code to user's email
 */
const handleSendResetCode = async (email, user, res, next) => {
  try {
    // Check rate limiting - user must wait 1 minute between requests
    const latestReset = await findLatestPasswordReset(email);
    if (latestReset) {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      if (latestReset.createdAt > oneMinuteAgo) {
        const remainingTime = Math.ceil(
          (latestReset.createdAt.getTime() + 60000 - Date.now()) / 1000
        );
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Please wait ${remainingTime} seconds before requesting a new code`,
        });
      }
    }

    // Generate secure 6-digit code
    const resetCode = crypto.randomInt(100000, 999999).toString();

    // Create password reset record
    await createPasswordReset({
      email: email.toLowerCase(),
      code: resetCode,
    });

    // Send email (silent failure)
    try {
      const emailTemplate = generatePasswordResetEmail({
        code: resetCode,
        userName: user.name,
        userEmail: email,
      });

      await Mailer.sendEmail({
        email: email,
        subject: "Reset Your Password - Boardddd",
        message: emailTemplate.text,
        html: emailTemplate.html,
      });

      console.log(`Password reset code sent to ${email}`);
    } catch (emailError) {
      console.error("Failed to send reset email:", emailError);
      // Continue execution - silent failure for email
    }

    return generateResponse(
      {
        success: true,
        resetCode, // for debuggin purposes will remove afterwards
      },
      "Reset code sent successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in handleSendResetCode:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Step 2: Verify reset code
 */
const handleCodeVerification = async (email, code, res, next) => {
  try {
    // Find password reset record
    const passwordReset = await findPasswordReset(email, code);
    if (!passwordReset) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid or expired code",
      });
    }

    // Check if expired
    if (isExpired(passwordReset)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Reset code has expired",
      });
    }

    // Check if max attempts exceeded
    if (hasExceededAttempts(passwordReset)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Maximum verification attempts exceeded. Please request a new code",
      });
    }

    // Code is valid
    return generateResponse(
      {
        success: true,
        message: "Code verified successfully",
        canResetPassword: true,
      },
      "Code verification successful",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in handleCodeVerification:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Step 3: Reset password with verified code
 */
const handlePasswordReset = async (email, code, newPassword, res, next) => {
  try {
    // Validate new password
    if (!newPassword || newPassword.length < 8) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Password must be at least 8 characters long",
      });
    }

    // Find password reset record
    const passwordReset = await findPasswordReset(email, code);
    if (!passwordReset) {
      // Increment attempts for invalid code
      const anyReset = await findLatestPasswordReset(email);
      if (anyReset && !isExpired(anyReset)) {
        await incrementAttempts(anyReset._id);
      }

      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid or expired code",
      });
    }

    // Check if expired
    if (isExpired(passwordReset)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Reset code has expired",
      });
    }

    // Check if max attempts exceeded
    if (hasExceededAttempts(passwordReset)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message:
          "Maximum verification attempts exceeded. Please request a new code",
      });
    }

    // Check if new password is the same as current password
    const user = await findUser({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const isSamePassword = await comparePassword(newPassword, user.password);
    if (isSamePassword) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "New password cannot be the same as your current password",
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update user password
    await updateUser(
      { email: email.toLowerCase() },
      { password: hashedPassword }
    );

    // Mark reset code as used
    await markPasswordResetAsUsed(passwordReset._id);

    return generateResponse(
      {
        success: true,
        message: "Password reset successfully",
      },
      "Password reset completed",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in handlePasswordReset:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
