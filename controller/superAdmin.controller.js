"use strict";

const { STATUS_CODES } = require("../utils/constants");
const { generateResponse } = require("../utils");
const {
  findSuperAdmin,
  createSuperAdmin: createSuperAdminModel,
  findManySuperAdmins,
} = require("../models/superAdminModel");
const {
  hashSuperAdminPassword,
  compareSuperAdminPassword,
  generateSuperAdminToken,
} = require("./helpers/superAdmin/auth.helper");
const { blacklistToken } = require("../services/tokenBlacklist");

// POST /super-admin/login
exports.loginSuperAdmin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const superAdmin = await findSuperAdmin({ email }).select("+password");

    if (!superAdmin || !superAdmin.isActive) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Invalid email or password",
      });
    }

    const isMatch = await compareSuperAdminPassword(
      password,
      superAdmin.password
    );

    if (!isMatch) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "Invalid email or password",
      });
    }

    const { token } = generateSuperAdminToken(superAdmin);

    return generateResponse(
      { token },
      "Logged in successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// POST /super-admin/logout
exports.logoutSuperAdmin = async (req, res, next) => {
  try {
    const accessToken = req.header("accessToken") || req.session.accessToken;
    if (accessToken) {
      await blacklistToken(accessToken, 600); // 10 min TTL
    }

    return generateResponse(
      null,
      "Logged out successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// POST /super-admin/admins
exports.createSuperAdmin = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const hashedPassword = await hashSuperAdminPassword(password);

    const superAdmin = await createSuperAdminModel({
      name,
      email,
      password: hashedPassword,
    });

    return generateResponse(
      {
        _id: superAdmin._id,
        name: superAdmin.name,
        email: superAdmin.email,
        isActive: superAdmin.isActive,
      },
      "Super admin created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// GET /super-admin/admins
exports.listSuperAdmins = async (req, res, next) => {
  try {
    const superAdmins = await findManySuperAdmins({});

    return generateResponse(
      superAdmins,
      "Super admins fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
