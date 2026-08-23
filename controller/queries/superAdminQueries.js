"use strict";

const { Types } = require("mongoose");

/**
 * Get all companies query for super-admin dashboard
 * Includes optional search on name/domain and a userCount lookup
 */
exports.getAllCompaniesQuery = (search) => {
  const matchStage = {};

  if (search && search.trim() !== "") {
    matchStage.$or = [
      { name: { $regex: search.trim(), $options: "i" } },
      { domain: { $regex: search.trim(), $options: "i" } },
    ];
  }

  return [
    {
      $match: matchStage,
    },

    // Lookup users belonging to this company for a count
    {
      $lookup: {
        from: "users",
        let: { companyId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$companyId", "$$companyId"] },
            },
          },
          { $count: "count" },
        ],
        as: "userCountLookup",
      },
    },

    {
      $project: {
        _id: 1,
        name: 1,
        domain: 1,
        isActive: 1,
        createdAt: 1,
        adminUser: 1,
        userCount: {
          $ifNull: [{ $arrayElemAt: ["$userCountLookup.count", 0] }, 0],
        },
      },
    },
    // Note: no $sort here — mongoose-aggregate-paginate-v2 applies its own
    // default sort ({ createdAt: -1 }) on top of the pipeline result.
  ];
};

/**
 * Get single company detail query for super-admin dashboard
 * Includes user role breakdown and invite-slot seat usage totals
 */
exports.getCompanyDetailQuery = (companyId) => {
  return [
    {
      $match: {
        _id: Types.ObjectId.createFromHexString(companyId),
      },
    },

    // Role breakdown of users in this company
    {
      $lookup: {
        from: "users",
        let: { companyId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$companyId", "$$companyId"] },
            },
          },
          {
            $group: {
              _id: "$role",
              count: { $sum: 1 },
            },
          },
        ],
        as: "usersByRole",
      },
    },

    // Seat usage totals from invite slots
    {
      $lookup: {
        from: "inviteslots",
        let: { companyId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$companyId", "$$companyId"] },
            },
          },
          {
            $group: {
              _id: null,
              totalSlots: { $sum: 1 },
              usedSlots: { $sum: { $cond: ["$used", 1, 0] } },
              reservedSlots: { $sum: { $cond: ["$reserved", 1, 0] } },
            },
          },
        ],
        as: "seatUsage",
      },
    },

    {
      $addFields: {
        roleBreakdown: "$usersByRole",
        seatUsage: {
          $ifNull: [
            { $arrayElemAt: ["$seatUsage", 0] },
            { totalSlots: 0, usedSlots: 0, reservedSlots: 0 },
          ],
        },
      },
    },

    {
      $project: {
        _id: 1,
        name: 1,
        domain: 1,
        logo: 1,
        isActive: 1,
        createdAt: 1,
        adminUser: 1,
        roleBreakdown: 1,
        seatUsage: 1,
      },
    },
  ];
};
