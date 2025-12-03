"use strict";

const { Types } = require("mongoose");

/**
 * Get all company users query for admin management
 * Includes search, pagination and company admin as "invited by"
 */
exports.getCompanyUsersAdminQuery = (companyId, searchTerm = null, excludeUserId = null) => {
  const matchStage = {
    companyId: Types.ObjectId.isValid(companyId) 
      ? new Types.ObjectId(companyId) 
      : companyId,
    // Include both active and inactive users
  };

  // Exclude logged-in user
  if (excludeUserId) {
    matchStage._id = { 
      $ne: Types.ObjectId.isValid(excludeUserId) 
        ? new Types.ObjectId(excludeUserId) 
        : excludeUserId 
    };
  }

  // Add search filter for name or email if provided
  if (searchTerm && searchTerm.trim() !== "") {
    matchStage.$or = [
      { name: { $regex: searchTerm.trim(), $options: "i" } },
      { email: { $regex: searchTerm.trim(), $options: "i" } }
    ];
  }

  return [
    {
      $match: matchStage
    },
    
    // Lookup company information to get admin user
    {
      $lookup: {
        from: "companies",
        localField: "companyId", 
        foreignField: "_id",
        as: "company",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              adminUser: 1
            }
          }
        ]
      }
    },
    
    // Unwind company (should be single company)
    {
      $unwind: {
        path: "$company",
        preserveNullAndEmptyArrays: true
      }
    },
    
    // Lookup admin user details for "invited by" 
    {
      $lookup: {
        from: "users",
        localField: "company.adminUser",
        foreignField: "_id", 
        as: "invitedByUser",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1
            }
          }
        ]
      }
    },
    
    // Unwind invited by user
    {
      $unwind: {
        path: "$invitedByUser", 
        preserveNullAndEmptyArrays: true
      }
    },
    
    // Calculate status and format response
    {
      $addFields: {
        // Status calculation
        status: {
          $cond: {
            if: { $eq: ["$isActive", false] },
            then: "inactive",
            else: {
              $cond: {
                if: { $ne: ["$expiresAt", null] },
                then: "guest", 
                else: "active"
              }
            }
          }
        },
        
        // Last active calculation (online if within 15 minutes)
        lastActiveStatus: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$lastLoginAt", null] },
                { 
                  $gte: [
                    "$lastLoginAt", 
                    { $subtract: [new Date(), 15 * 60 * 1000] } // 15 minutes ago
                  ]
                }
              ]
            },
            then: "online",
            else: "offline"
          }
        },
        
        // Invited by information (company admin)
        invitedBy: {
          $cond: {
            if: { $eq: ["$_id", "$company.adminUser"] },
            then: "Self (Company Admin)",
            else: {
              $cond: {
                if: { $ne: ["$invitedByUser", null] },
                then: {
                  name: "$invitedByUser.name",
                  email: "$invitedByUser.email",
                  _id: "$invitedByUser._id",
                  title: "$invitedByUser.title",
                  designation: "$invitedByUser.designation",
                  image: "$invitedByUser.image",
                  coverImage: "$invitedByUser.coverImage",
                  description: "$invitedByUser.description",
                  dob: "$invitedByUser.dob",
                  gender: "$invitedByUser.gender",
                  nickname: "$invitedByUser.nickname"
                },
                else: "Unknown"
              }
            }
          }
        }
      }
    },
    
    // Project final fields for admin view
    {
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        role: 1,

        // Profile fields
        image: 1,
        coverImage: 1,
        title: 1,
        designation: 1,
        description: 1,
        dob: 1,
        gender: 1,
        nickname: 1,
        isDemo: 1,

        // Status and activity fields
        status: 1,
        lastActiveStatus: 1,
        lastLoginAt: 1,
        createdAt: 1,
        isActive: 1,
        expiresAt: 1,
        invitedBy: 1,
        company: {
          _id: "$company._id",
          name: "$company.name"
        }
      }
    },
    
    // Sort by creation date (newest first)
    {
      $sort: { createdAt: -1 }
    }
  ];
};

/**
 * Get invited users from reserved invite slots
 * Returns only invited users who have reserved slots but haven't joined yet
 */
exports.getInvitedUsersQuery = (companyId, searchTerm = null) => {
  const matchStage = {
    companyId: Types.ObjectId.isValid(companyId) 
      ? new Types.ObjectId(companyId) 
      : companyId,
    reserved: true,  // Reserved slots
    used: false      // But not used yet
  };

  // Add search filter for email if provided
  if (searchTerm && searchTerm.trim() !== "") {
    matchStage.reservedFor = { $regex: searchTerm.trim(), $options: "i" };
  }

  return [
    {
      $match: matchStage
    },
    
    // Lookup company admin for "invited by"
    {
      $lookup: {
        from: "companies",
        localField: "companyId",
        foreignField: "_id",
        as: "company",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              adminUser: 1
            }
          }
        ]
      }
    },
    
    {
      $unwind: {
        path: "$company",
        preserveNullAndEmptyArrays: true
      }
    },
    
    // Lookup admin user details
    {
      $lookup: {
        from: "users",
        localField: "company.adminUser",
        foreignField: "_id",
        as: "invitedByUser",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              title: 1,
              designation: 1,
              image: 1,
              coverImage: 1,
              description: 1,
              dob: 1,
              gender: 1,
              nickname: 1
            }
          }
        ]
      }
    },

    {
      $unwind: {
        path: "$invitedByUser",
        preserveNullAndEmptyArrays: true
      }
    },
    
    // Project final fields
    {
      $project: {
        _id: 1,
        email: "$reservedFor",
        role: "$reservedRole", 
        status: "not active", // Custom status field for all invited users
        invitationDate: "$reservedAt", // Use reservedAt as invitation date
        inviteType: "$inviteType", // company or guest
        isGuestInviteSlot: "$isGuestInviteSlot",
        channelId: "$channelId",
        invitedBy: {
          $cond: {
            if: { $ne: ["$invitedByUser", null] },
            then: {
              name: "$invitedByUser.name",
              email: "$invitedByUser.email",
              _id: "$invitedByUser._id"
            },
            else: "Unknown"
          }
        },
        company: {
          _id: "$company._id",
          name: "$company.name"
        }
      }
    },
    
    // Sort by invitation date (newest first)
    {
      $sort: { invitationDate: -1 }
    }
  ];
};

