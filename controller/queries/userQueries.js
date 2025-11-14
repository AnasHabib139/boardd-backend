const { Types } = require("mongoose");

// Get users of a particular company with optional search functionality
exports.getCompanyUsersQuery = (companyId, currentUserId, searchTerm) => {
  let queryArray = [];

  // Match either company users OR the global demo user
  queryArray.push({
    $match: {
      $or: [
        { companyId: Types.ObjectId.createFromHexString(companyId) },
        { isDemo: true }, // Always include demo user
      ],
    },
  });

  // Add active users filter
  queryArray.push({ $match: { isActive: true } });

  // Exclude the current logged-in user from results (but keep demo user)
  queryArray.push({
    $match: {
      $or: [
        { _id: { $ne: Types.ObjectId.createFromHexString(currentUserId) } },
        { isDemo: true },
      ],
    },
  });

  // Only add search logic if search term is provided
  if (searchTerm && searchTerm.trim() !== "") {
    const cleanSearchTerm = searchTerm.trim();

    // Search for the term only in email (demo user will be filtered out if no match)
    queryArray.push({
      $match: {
        email: { $regex: cleanSearchTerm, $options: "i" },
      },
    });

    // Add fields to calculate ranking score for email only
    queryArray.push({
      $addFields: {
        emailStartsWithSearch: {
          $cond: {
            if: {
              $regexMatch: {
                input: "$email",
                regex: `^${cleanSearchTerm}`,
                options: "i",
              },
            },
            then: 1,
            else: 0,
          },
        },
        sortScore: {
          $add: [
            {
              $cond: {
                if: {
                  $regexMatch: {
                    input: "$email",
                    regex: `^${cleanSearchTerm}`,
                    options: "i",
                  },
                },
                then: 10, // High priority for email starting with search
                else: 0,
              },
            },
            {
              $cond: {
                if: {
                  $regexMatch: {
                    input: "$email",
                    regex: cleanSearchTerm,
                    options: "i",
                  },
                },
                then: 2, // Lower priority for email containing search
                else: 0,
              },
            },
          ],
        },
      },
    });

    // Sort by demo status first (demo users last), then by score, then by name
    queryArray.push({
      $sort: {
        isDemo: 1, // Demo users appear last
        sortScore: -1,
        name: 1,
      },
    });

    // Remove the temporary fields before returning results
    queryArray.push({
      $project: {
        emailStartsWithSearch: 0,
        sortScore: 0,
      },
    });
  } else {
    // If no search term, sort by demo status first, then by name
    queryArray.push({
      $sort: {
        isDemo: 1, // Demo users appear last
        name: 1,
      },
    });
  }

  // Project only specific fields for all queries
  queryArray.push({
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
      nickname: 1,
      role: 1,
      isActive: 1,
      companyId: 1,
      isDemo: 1, // Include demo flag for frontend
    },
  });

  return queryArray;
};

// Get unique designations for a company (for dropdown filters)
exports.getUniqueDesignationsQuery = (companyId) => {
  return [
    {
      $match: {
        companyId: Types.ObjectId.createFromHexString(companyId),
        isActive: true,
        designation: { $exists: true, $ne: null, $ne: "" }
      }
    },
    {
      $group: {
        _id: "$designation"
      }
    },
    {
      $sort: { _id: 1 }
    },
    {
      $project: {
        _id: 0,
        designation: "$_id"
      }
    }
  ];
};
