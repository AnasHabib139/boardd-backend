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
const {
  blacklistToken,
  blacklistCompanyTokens,
} = require("../services/tokenBlacklist");
const {
  findCompany,
  updateCompany,
  getAllCompanies: getAllCompaniesModel,
} = require("../models/companyModel");
const {
  createSuperAdminAuditLog,
  getCompanyAuditLog,
} = require("../models/superAdminAuditLogModel");
const {
  getAllCompaniesQuery,
  getCompanyDetailQuery,
  getAllPlatformUsersQuery,
  getPlatformUserDetailQuery,
} = require("./queries/superAdminQueries");
const { getCompanyUsersAdminQuery } = require("./queries/adminQueries");
const { getAllUsers } = require("../models/userModel");
const { model } = require("mongoose");

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

// PUT /super-admin/companies/:companyId/status
exports.updateCompanyStatus = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { isActive, reason } = req.body;

    const company = await findCompany({ _id: companyId });

    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    await updateCompany({ _id: companyId }, { isActive });

    if (!isActive) {
      await blacklistCompanyTokens(companyId);
    }

    await createSuperAdminAuditLog({
      superAdminId: req.superAdmin.id,
      action: isActive ? "company_enabled" : "company_disabled",
      companyId,
      reason,
    });

    const updatedCompany = await findCompany({ _id: companyId });

    return generateResponse(
      updatedCompany,
      isActive ? "Company enabled successfully" : "Company disabled successfully",
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

// GET /super-admin/companies/:companyId/audit-log
exports.getCompanyAuditLogHandler = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { page, limit } = req.query;

    const auditLog = await getCompanyAuditLog({
      companyId,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
    });

    return generateResponse(
      auditLog,
      "Audit log fetched successfully",
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

// GET /super-admin/companies
exports.getAllCompanies = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;

    const aggregationQuery = getAllCompaniesQuery(search);

    const result = await getAllCompaniesModel({
      query: aggregationQuery,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "companies",
    });

    return generateResponse(
      result,
      "Companies fetched successfully",
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

// GET /super-admin/companies/:companyId
exports.getCompanyDetail = async (req, res, next) => {
  try {
    const { companyId } = req.params;

    const CompanyModel = model("Company");
    const result = await CompanyModel.aggregate(
      getCompanyDetailQuery(companyId)
    );

    if (!result || result.length === 0) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    return generateResponse(
      result[0],
      "Company details fetched successfully",
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

// GET /super-admin/companies/:companyId/users
exports.getCompanyUsers = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { search, page, limit } = req.query;

    const aggregationQuery = getCompanyUsersAdminQuery(companyId, search);

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
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// GET /super-admin/users
exports.getAllPlatformUsers = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;

    const aggregationQuery = getAllPlatformUsersQuery(search);

    const result = await getAllUsers({
      query: aggregationQuery,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "users",
    });

    return generateResponse(
      result,
      "Platform users fetched successfully",
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

// GET /super-admin/users/:userId
exports.getPlatformUserDetail = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const UserModel = model("User");
    const result = await UserModel.aggregate(
      getPlatformUserDetailQuery(userId)
    );

    if (!result || result.length === 0) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    return generateResponse(
      result[0],
      "User details fetched successfully",
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

// GET /super-admin/stats/overview
exports.getStatsOverview = async (req, res, next) => {
  try {
    const CompanyModel = model("Company");
    const UserModel = model("User");

    const [totalCompanies, inactiveCompanies, totalUsers, inactiveUsers] =
      await Promise.all([
        CompanyModel.countDocuments(),
        CompanyModel.countDocuments({ isActive: false }),
        UserModel.countDocuments(),
        UserModel.countDocuments({ isActive: false }),
      ]);

    return generateResponse(
      {
        totalCompanies,
        activeCompanies: totalCompanies - inactiveCompanies,
        inactiveCompanies,
        totalUsers,
        activeUsers: totalUsers - inactiveUsers,
        inactiveUsers,
      },
      "Stats overview fetched successfully",
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

// GET /super-admin/stats/growth
exports.getStatsGrowth = async (req, res, next) => {
  try {
    const { from, to } = req.query;

    let toDate = new Date(to);
    if (isNaN(toDate.getTime())) {
      toDate = new Date();
    }

    let fromDate = new Date(from);
    if (isNaN(fromDate.getTime())) {
      fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 30);
    }

    const CompanyModel = model("Company");
    const UserModel = model("User");

    const growthPipeline = [
      { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$createdAt", unit: "day" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: "$_id", count: 1 } },
    ];

    const [companiesPerDay, usersPerDay] = await Promise.all([
      CompanyModel.aggregate(growthPipeline),
      UserModel.aggregate(growthPipeline),
    ]);

    return generateResponse(
      { companiesPerDay, usersPerDay },
      "Stats growth fetched successfully",
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
