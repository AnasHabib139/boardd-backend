"use strict";

const { FORM_TYPE } = require("../../utils/constants");

/**
 * Build aggregation pipeline for folder forms
 * @param {Object} options - Query options
 * @param {Object} options.user - User object with _id and companyId
 * @param {string} options.type - Form type filter
 * @param {string} options.created_by - Created by filter ("by_me")
 * @param {string} options.status - Status filter ("all", "shared", "private")
 * @param {string} options.sortBy - Sort option ("latest_viewed")
 * @returns {Array} MongoDB aggregation pipeline
 */
exports.buildFolderFormsQuery = ({ user, type, created_by, status, sortBy }) => {
  const query = [
    {
      $match: {
        isFolder: true,
        isActive: true,
      },
    },
  ];

  // Add type filter if provided (unless status is "all" which overrides type)
  if (type && Object.values(FORM_TYPE).includes(type) && status !== "all") {
    query[0].$match.type = type;
  }

  // Add status-specific filters
  if (status === "shared") {
    // Forms that have been shared (have form invites)
    query.push({
      $lookup: {
        from: "forminvites",
        localField: "_id",
        foreignField: "formId",
        as: "invites",
        pipeline: [{ $match: { isActive: true } }],
      },
    });
    query.push({
      $match: {
        "invites.0": { $exists: true }, // Must have at least one invite
      },
    });
  } else if (status === "private") {
    // Private forms only
    query[0].$match.isPrivate = true;
  }

  // Add user details lookup
  query.push(
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    {
      $unwind: "$creator",
    },
    {
      $match: {
        "creator.companyId": user.companyId,
        // Add created_by filter if 'by_me' is specified
        ...(created_by === "by_me" && { "creator._id": user._id }),
      },
    }
  );

  // Add personalized favorite lookup
  query.push(
    {
      $lookup: {
        from: "formfavorites",
        let: { formId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$formId", "$$formId"] },
                  { $eq: ["$userId", user._id] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "fav",
      },
    },
    { $addFields: { isFav: { $gt: [{ $size: "$fav" }, 0] } } }
  );

  // Add last viewed lookup
  query.push(
    {
      $lookup: {
        from: "formviews",
        let: { formId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$formId", "$$formId"] },
                  { $eq: ["$userId", user._id] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "views",
      },
    },
    {
      $addFields: {
        lastViewedAt: {
          $ifNull: [{ $arrayElemAt: ["$views.lastViewedAt", 0] }, null],
        },
      },
    }
  );

  // Add form invites lookup for sharing statistics (unless status is private)
  if (status !== "private") {
    query.push(
      {
        $lookup: {
          from: "forminvites",
          localField: "_id",
          foreignField: "formId",
          as: "invites",
          pipeline: [{ $match: { isActive: true } }],
        },
      },
      {
        $addFields: {
          totalResponses: {
            $size: {
              $filter: {
                input: "$invites",
                as: "invite",
                cond: { $eq: ["$$invite.hasResponded", true] },
              },
            },
          },
          totalWaiting: {
            $size: {
              $filter: {
                input: "$invites",
                as: "invite",
                cond: { $eq: ["$$invite.hasResponded", false] },
              },
            },
          },
          totalShared: { $size: "$invites" },
          sharedWithData: {
            $map: {
              input: "$invites",
              as: "invite",
              in: {
                name: "$$invite.invitedName",
                email: "$$invite.invitedEmail",
                dateTime: "$$invite.respondedAt",
                isSubmitted: "$$invite.hasResponded",
                sharedAt: "$$invite.createdAt",
              },
            },
          },
        },
      }
    );
  }

  // Add projection
  query.push({
    $project: {
      title: 1,
      description: 1,
      type: 1,
      status: 1,
      responseCount: 1,
      createdAt: 1,
      updatedAt: 1,
      lastViewedAt: 1,
      isFav: 1,
      isFolder: 1,
      isPrivate: 1,
      ...(status !== "private" && {
        totalResponses: 1,
        totalWaiting: 1,
        totalShared: 1,
        sharedWithData: 1,
      }),
      creator: {
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
        nickname: 1,
      },
    },
  });

  return query;
};

/**
 * Build aggregation pipeline for folder favorites
 * @param {Object} options - Query options (same as buildFolderFormsQuery)
 * @returns {Array} MongoDB aggregation pipeline
 */
exports.buildFolderFavoritesQuery = ({ user, type, created_by, status, sortBy }) => {
  const query = [
    { $match: { isFolder: true, isActive: true } },
  ];

  // Add type filter if provided (unless status is "all")
  if (type && Object.values(FORM_TYPE).includes(type) && status !== "all") {
    query.push({ $match: { type } });
  }

  // Add status-specific filters
  if (status === "shared") {
    query.push({
      $lookup: {
        from: "forminvites",
        localField: "_id",
        foreignField: "formId",
        as: "invites",
        pipeline: [{ $match: { isActive: true } }],
      },
    });
    query.push({
      $match: {
        "invites.0": { $exists: true },
      },
    });
  } else if (status === "private") {
    query[0].$match.isPrivate = true;
  }

  // Join creator and filter by same company
  query.push(
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    { $unwind: "$creator" },
    { 
      $match: { 
        "creator.companyId": user.companyId,
        ...(created_by === "by_me" && { "creator._id": user._id }),
      } 
    }
  );

  // Join favorites for this user (filter to only favorites)
  query.push(
    {
      $lookup: {
        from: "formfavorites",
        let: { formId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$formId", "$$formId"] },
                  { $eq: ["$userId", user._id] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "fav",
      },
    },
    { $addFields: { isFav: { $gt: [{ $size: "$fav" }, 0] } } },
    { $match: { isFav: true } } // Only show favorites
  );

  // Join last viewed for this user
  query.push(
    {
      $lookup: {
        from: "formviews",
        let: { formId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$formId", "$$formId"] },
                  { $eq: ["$userId", user._id] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "views",
      },
    },
    {
      $addFields: {
        lastViewedAt: {
          $ifNull: [{ $arrayElemAt: ["$views.lastViewedAt", 0] }, null],
        },
      },
    }
  );

  // Add projection
  query.push({
    $project: {
      title: 1,
      description: 1,
      type: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
      lastViewedAt: 1,
      isFolder: 1,
      isPrivate: 1,
      isFav: 1,
      creator: { _id: 1, name: 1, email: 1, title: 1, designation: 1, image: 1, coverImage: 1, description: 1, dob: 1, gender: 1, nickname: 1 },
    },
  });

  return query;
};

/**
 * Get sort options based on sortBy parameter
 * @param {string} sortBy - Sort option ("latest_viewed")
 * @returns {Object} Sort configuration for getAllForms
 */
exports.getSortOptions = (sortBy) => {
  if (sortBy === "latest_viewed") {
    return { lastViewedAt: -1, createdAt: -1 };
  }
  return { createdAt: -1 }; // Default sort
};