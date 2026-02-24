const { findCompany } = require("../../../models/companyModel");
const {
  findInviteSlot,
  updateInviteSlot,
  findAvailableInviteSlot,
} = require("../../../models/inviteSlotModel");
const { findUser } = require("../../../models/userModel");
const { extractDomainFromEmail } = require("../../../utils");
const {
  handlePublicSignup,
  handleInviteSignup,
  handleRegularLogin,
  handleDomainSignup,
  handleGuestSignup,
} = require("./login.helper");
const { STATUS_CODES, isConsumerDomain } = require("../../../utils/constants");

/**
 * Determine which login strategy to use based on parameters
 */
exports.determineLoginStrategy = async (token, joinToken, email) => {
  if (token) {
    // Check if token is for guest signup or company signup
    const inviteSlot = await findInviteSlot({ token });
    if (!inviteSlot || inviteSlot.used) {
      return { type: "INVALID_TOKEN", data: { token } };
    }

    // Differentiate based on slot type
    if (inviteSlot.isGuestInviteSlot) {
      return { type: "GUEST_SIGNUP", data: { token, inviteSlot } };
    } else {
      return { type: "INVITE_SIGNUP", data: { token, inviteSlot } };
    }
  }

  if (joinToken) {
    return { type: "PUBLIC_SIGNUP", data: { joinToken } };
  }

  // Check if user exists to determine regular login vs domain signup
  const existingUser = await findUser({ email }).select("+password");
  if (existingUser) {
    return { type: "REGULAR_LOGIN", data: { user: existingUser, email } };
  }

  return { type: "DOMAIN_SIGNUP", data: { email } };
};

/**
 * Handle invite-based signup flow
 */
exports.handleInviteFlow = async (strategyData, userData, req, res, next) => {
  const { token, inviteSlot } = strategyData;
  const { name, email, password } = userData;

  // Use the inviteSlot from strategy data (already validated)
  if (!inviteSlot || inviteSlot?.used) {
    return next({
      statusCode: STATUS_CODES.NOT_FOUND,
      message: inviteSlot?.used
        ? "Invite slot already used"
        : "Invite slot not found",
    });
  }

  const company = await findCompany({ _id: inviteSlot?.companyId });
  if (!company) {
    return next({
      statusCode: STATUS_CODES.NOT_FOUND,
      message: "Company not found",
    });
  }

  // Handle invite signup and mark slot as used
  const result = await handleInviteSignup(
    name,
    email,
    password,
    company,
    inviteSlot,
    req,
    res,
    next
  );

  if (result?.statusCode === STATUS_CODES.SUCCESS) {
    await updateInviteSlot(
      {
        _id: inviteSlot._id,
      },
      {
        used: true,
        inviteType: "company",
      }
    );
  }

  return result;
};

/**
 * Handle public link signup flow
 */
exports.handlePublicFlow = async (strategyData, userData, req, res, next) => {
  const { joinToken } = strategyData;
  const { name, email, password } = userData;

  // Find company by joinToken
  const company = await findCompany({ joinToken });
  if (!company) {
    return next({
      statusCode: STATUS_CODES.NOT_FOUND,
      message: "Company not found",
    });
  }

  // Check if user with this email already exists
  const existingUser = await findUser({ email });
  if (existingUser) {
    return next({
      statusCode: STATUS_CODES.CONFLICT,
      message: "User already exists",
    });
  }

  // Find an available invite slot (COMPANY SLOTS ONLY)
  const availableSlot = await findAvailableInviteSlot({
    companyId: company._id,
    isGuestInviteSlot: false, // Only company slots for public signup
  });
  if (!availableSlot) {
    return next({
      statusCode: STATUS_CODES.NOT_FOUND,
      message: "No available company invite slots found",
    });
  }

  // Handle public signup and mark slot as used
  const result = await handlePublicSignup(
    name,
    email,
    password,
    company,
    req,
    res,
    next
  );

  if (result?.statusCode === STATUS_CODES.SUCCESS) {
    await updateInviteSlot({ _id: availableSlot._id }, { used: true });
  }

  return result;
};

/**
 * Handle regular login flow
 */
exports.handleRegularFlow = async (strategyData, userData, req, res, next) => {
  const { user: existingUser, email } = strategyData;
  const { password } = userData;

  const domain = extractDomainFromEmail(email);

  // Skip domain lookup for consumer domains (avoids ambiguous match).
  // handleRegularLogin doesn't use the company param.
  let company = null;
  if (!isConsumerDomain(domain)) {
    company = await findCompany({ domain });
  }

  return await handleRegularLogin(
    existingUser,
    password,
    company,
    req,
    res,
    next
  );
};

/**
 * Handle domain-based signup flow
 */
exports.handleDomainFlow = async (strategyData, userData, req, res, next) => {
  const { email } = strategyData;
  const { name, password } = userData;

  // Additional safety check for existing user (should be caught by determineLoginStrategy)
  const existingUser = await findUser({ email });
  if (existingUser) {
    return next({
      statusCode: STATUS_CODES.CONFLICT,
      message: "User already exists",
    });
  }

  // Handle domain-based signup
  const domain = extractDomainFromEmail(email);

  // Consumer domains cannot auto-join companies by domain matching.
  // They must use invite links or sign up via Google auth.
  if (isConsumerDomain(domain)) {
    return next({
      statusCode: STATUS_CODES.NOT_FOUND,
      message: "No matching company domain",
    });
  }

  const company = await findCompany({ domain });

  if (!company) {
    return next({
      statusCode: STATUS_CODES.NOT_FOUND,
      message: "No matching company domain",
    });
  }

  // Check if user will be active (automatic signup enabled)
  const willBeActive = company.automaticSignup === true;
  let availableSlot = null;

  // Only consume slot if user will be active
  if (willBeActive) {
    availableSlot = await findAvailableInviteSlot({
      companyId: company._id,
      isGuestInviteSlot: false, // Only company slots for domain signup
    });

    if (!availableSlot) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "No available company invite slots for domain signup",
      });
    }
  }

  // Handle domain signup
  const result = await handleDomainSignup(
    name,
    email,
    password,
    company,
    req,
    res,
    next
  );

  // Only mark slot as used if user is active and slot was reserved
  if (
    result?.statusCode === STATUS_CODES.SUCCESS &&
    willBeActive &&
    availableSlot
  ) {
    await updateInviteSlot(
      { _id: availableSlot._id },
      {
        used: true,
        usedBy: result.data?.user?._id, // Get user ID from response
        usedAt: new Date(),
        inviteType: "company",
      }
    );
  }

  return result;
};

/**
 * Handle guest signup flow
 */
exports.handleGuestFlow = async (strategyData, userData, req, res, next) => {
  const { token, inviteSlot } = strategyData;
  const { name, email, password } = userData;

  const company = await findCompany({ _id: inviteSlot?.companyId });
  if (!company) {
    return next({
      statusCode: STATUS_CODES.NOT_FOUND,
      message: "Company not found",
    });
  }

  // Handle guest signup with 3-month expiry
  const result = await handleGuestSignup(
    name,
    email,
    password,
    company,
    inviteSlot,
    req,
    res,
    next
  );

  if (result?.statusCode === STATUS_CODES.SUCCESS) {
    await updateInviteSlot(
      {
        _id: inviteSlot._id,
      },
      {
        used: true,
        inviteType: "guest",
      }
    );
  }

  return result;
};
