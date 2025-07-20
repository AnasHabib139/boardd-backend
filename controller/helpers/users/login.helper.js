const { generateResponse, setRefreshTokenCookie } = require("../../../utils");
const { STATUS_CODES, ROLES } = require("../../../utils/constants");
const {
  calculateRefreshTokenExpiry,
} = require("../../../utils/tokenConstants");
const {
  createUser,
  generateToken,
  generateRefreshToken,
  findUser,
  addRefreshToken,
} = require("../../../models/userModel");
const { hashPassword, comparePassword } = require("./signup.helper");
const { extractDeviceInfo } = require("../../../utils/deviceDetection");

// Helper function to create and store refresh token
const createAndStoreRefreshToken = async (user, req) => {
  try {
    // Generate both tokens
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Get device info
    const deviceInfo = extractDeviceInfo(req);

    // Calculate expiration date (30 days from now)
    const expiresAt = calculateRefreshTokenExpiry();

    // Create refresh token data
    const refreshTokenData = {
      token: refreshToken,
      deviceInfo,
      expiresAt,
    };

    // Add refresh token to user's array
    await addRefreshToken(user._id, refreshTokenData);

    return { accessToken, refreshToken };
  } catch (error) {
    console.error("Error creating refresh token:", error);
    throw new Error("Failed to generate authentication tokens");
  }
};

// Helper function to validate domain match
const validateDomainMatch = (email, companyDomain) => {
  const userDomain = email?.split("@")?.[1];
  return userDomain === companyDomain;
};

// Helper function to create user and generate response
const createUserAndResponse = async (userData, req, res, successMessage) => {
  try {
    // Create new user
    const hashedPassword = await hashPassword(userData.password);
    const user = await createUser({
      ...userData,
      password: hashedPassword,
    });

    // Fetch clean user object without password and refresh tokens for response
    const cleanUser = await findUser({ _id: user._id }).select(
      "-refreshTokens"
    );

    // Generate both tokens and store refresh token
    const { accessToken, refreshToken } = await createAndStoreRefreshToken(
      cleanUser,
      req
    );

    // Set refresh token as httpOnly cookie
    setRefreshTokenCookie(res, refreshToken);

    return generateResponse(
      {
        user: cleanUser,
        accessToken,
      },
      successMessage,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error creating user:", error);
    throw new Error("Failed to create user account");
  }
};

exports.handleInviteSignup = async (
  name,
  email,
  password,
  company,
  inviteSlot,
  req,
  res,
  next
) => {
  try {
    // Check if user with this email already exists
    const existingUser = await findUser({ email });
    if (existingUser) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "User already exists",
      });
    }

    // Validate company domain
    if (!validateDomainMatch(email, company?.domain)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid company domain",
      });
    }

    // Check if the slot is reserved for a specific email
    if (
      inviteSlot?.reserved &&
      inviteSlot?.reservedFor &&
      inviteSlot.reservedFor !== email
    ) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "This invite link is reserved for a different email address",
      });
    }

    // Determine role based on reservation or default to EMPLOYEE
    const role = inviteSlot?.reservedRole ?? ROLES.EMPLOYEE;

    // Create user data
    const userData = {
      name,
      email,
      password,
      companyId: company._id,
      isActive: true, // Users from invite are active by default
      role,
    };

    return await createUserAndResponse(
      userData,
      req,
      res,
      "User signed up successfully"
    );
  } catch (error) {
    console.error("Error in handleInviteSignup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process invite signup",
    });
  }
};

exports.handlePublicSignup = async (
  name,
  email,
  password,
  company,
  req,
  res,
  next
) => {
  try {
    // Create user data
    const userData = {
      name,
      email,
      password,
      companyId: company._id,
      isActive: true, // Public link users are active by default
      role: ROLES.EMPLOYEE, // Default role for public signups
    };

    return await createUserAndResponse(
      userData,
      req,
      res,
      "User signed up successfully via public link"
    );
  } catch (error) {
    console.error("Error in handlePublicSignup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process public signup",
    });
  }
};

exports.handleDomainSignup = async (
  name,
  email,
  password,
  company,
  req,
  res,
  next
) => {
  try {
    // Assign name from email first part if not provided
    const userName = name || email?.split("@")?.[0] || "User";

    // Create user data
    const userData = {
      name: userName,
      email,
      password,
      companyId: company._id,
      isActive: company.automaticSignup ? true : false, // Set user as inactive by default for domain signups
      role: ROLES.EMPLOYEE, // Default role for domain signups
    };

    // Determine appropriate success message
    const successMessage = company.automaticSignup
      ? "User account created and activated successfully."
      : "User account created successfully. Waiting for admin approval.";

    return await createUserAndResponse(userData, req, res, successMessage);
  } catch (error) {
    console.error("Error in handleDomainSignup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process domain signup",
    });
  }
};

exports.handleRegularLogin = async (
  user,
  password,
  company,
  req,
  res,
  next
) => {
  try {
    // Check if user account is active
    if (!user?.isActive) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Account is inactive. Please wait for admin approval.",
      });
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user?.password);
    if (!isPasswordValid) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Invalid password",
      });
    }

    // Fetch clean user object without password and refresh tokens for response
    const cleanUser = await findUser({ _id: user._id }).select(
      "-refreshTokens"
    );

    // Generate both tokens and store refresh token
    const { accessToken, refreshToken } = await createAndStoreRefreshToken(
      cleanUser,
      req
    );

    // Set refresh token as httpOnly cookie
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
    console.error("Error in handleRegularLogin:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process login",
    });
  }
};

exports.handleGuestSignup = async (
  name,
  email,
  password,
  company,
  inviteSlot,
  req,
  res,
  next
) => {
  try {
    // Check if user with this email already exists
    const existingUser = await findUser({ email });
    if (existingUser) {
      return next({
        statusCode: STATUS_CODES.CONFLICT,
        message: "User already exists",
      });
    }

    // For guests, we don't validate domain match - they can be from any domain

    // Check if the slot is reserved for a specific email (guest invites can be reserved too)
    if (
      inviteSlot?.reserved &&
      inviteSlot?.reservedFor &&
      inviteSlot.reservedFor !== email
    ) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "This invite link is reserved for a different email address",
      });
    }

    // Calculate 3-month expiry for guest account
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    // Create user data with guest role and expiry
    const userData = {
      name,
      email,
      password,
      companyId: company._id,
      isActive: true, // Guest users are active by default
      role: ROLES.GUEST, // Always guest role
      expiresAt: threeMonthsFromNow, // 3-month expiry for guests
    };

    return await createUserAndResponse(
      userData,
      req,
      res,
      "Guest account created successfully (expires in 3 months)"
    );
  } catch (error) {
    console.error("Error in handleGuestSignup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to process guest signup",
    });
  }
};
