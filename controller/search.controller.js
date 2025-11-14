"use strict";

const Task = require("../models/taskModel");
const User = require("../models/userModel");
const { findUser } = require("../models/userModel");
const ChatMessage = require("../models/chatMessageModel");
const Form = require("../models/formModel");
const { STATUS_CODES } = require("../utils/constants");
const {
  buildTasksSearchPipeline,
  buildMembersSearchPipeline,
  buildTasksCountPipeline,
  buildMembersCountPipeline,
  buildChatsSearchPipeline,
  buildChatsCountPipeline,
  buildFilesSearchPipeline,
  buildFilesCountPipeline,
  buildFoldersSearchPipeline,
  buildFoldersCountPipeline,
  buildDocumentsSearchPipeline,
  buildDocumentsCountPipeline,
  buildTemplatesSearchPipeline,
  buildTemplatesCountPipeline
} = require("./queries/searchQueries");
const { getUniqueDesignationsQuery } = require("./queries/userQueries");

/**
 * Global search across multiple entity types
 * GET /api/search
 */
const globalSearch = async (req, res) => {
  try {
    const {
      q: searchQuery,
      types,
      assignedTo,
      createdBy,
      status,
      startDate,
      endDate,
      designation,
      sortBy,
      page,
      limit
    } = req.validatedQuery;

    const userId = req.user._id;
    const companyId = req.user.companyId;

    // Determine which entity types to search
    let typesToSearch = [];
    if (types === "all") {
      typesToSearch = ["tasks", "members", "chats", "files", "folders", "documents", "templates"];
    } else {
      typesToSearch = types.split(",");
    }

    // Build filters object
    const filters = {
      searchQuery,
      companyId,
      userId,
      assignedTo,
      createdBy,
      status,
      startDate,
      endDate,
      designation,
      sortBy,
      page,
      limit
    };

    // Prepare results object
    const results = {};
    let totalResults = 0;

    // Search tasks
    if (typesToSearch.includes("tasks")) {
      try {
        const tasksPipeline = buildTasksSearchPipeline(filters);
        const tasksCountPipeline = buildTasksCountPipeline(filters);

        const [tasksData, tasksCountData] = await Promise.all([
          Task.aggregate(tasksPipeline),
          Task.aggregate(tasksCountPipeline)
        ]);

        const tasksTotal = tasksCountData.length > 0 ? tasksCountData[0].total : 0;

        results.tasks = {
          total: tasksTotal,
          data: tasksData,
          page,
          limit,
          totalPages: Math.ceil(tasksTotal / limit)
        };

        totalResults += tasksTotal;
      } catch (error) {
        console.error("Error searching tasks:", error);
        results.tasks = {
          total: 0,
          data: [],
          error: "Failed to search tasks"
        };
      }
    }

    // Search members
    if (typesToSearch.includes("members")) {
      try {
        const membersPipeline = buildMembersSearchPipeline(filters);
        const membersCountPipeline = buildMembersCountPipeline(filters);

        const [membersData, membersCountData] = await Promise.all([
          User.aggregate(membersPipeline),
          User.aggregate(membersCountPipeline)
        ]);

        const membersTotal = membersCountData.length > 0 ? membersCountData[0].total : 0;

        results.members = {
          total: membersTotal,
          data: membersData,
          page,
          limit,
          totalPages: Math.ceil(membersTotal / limit)
        };

        totalResults += membersTotal;
      } catch (error) {
        console.error("Error searching members:", error);
        results.members = {
          total: 0,
          data: [],
          error: "Failed to search members"
        };
      }
    }

    // Search chats
    if (typesToSearch.includes("chats")) {
      try {
        const chatsPipeline = buildChatsSearchPipeline(filters);
        const chatsCountPipeline = buildChatsCountPipeline(filters);

        const [chatsData, chatsCountData] = await Promise.all([
          ChatMessage.aggregate(chatsPipeline),
          ChatMessage.aggregate(chatsCountPipeline)
        ]);

        const chatsTotal = chatsCountData.length > 0 ? chatsCountData[0].total : 0;

        results.chats = {
          total: chatsTotal,
          data: chatsData,
          page,
          limit,
          totalPages: Math.ceil(chatsTotal / limit)
        };

        totalResults += chatsTotal;
      } catch (error) {
        console.error("Error searching chats:", error);
        results.chats = {
          total: 0,
          data: [],
          error: "Failed to search chats"
        };
      }
    }

    // Search files (task and chat attachments)
    if (typesToSearch.includes("files")) {
      try {
        const filesPipeline = buildFilesSearchPipeline(filters);
        const filesCountPipeline = buildFilesCountPipeline(filters);

        const [filesData, filesCountData] = await Promise.all([
          Task.aggregate(filesPipeline),
          Task.aggregate(filesCountPipeline)
        ]);

        const filesTotal = filesCountData.length > 0 ? filesCountData[0].total : 0;

        results.files = {
          total: filesTotal,
          data: filesData,
          page,
          limit,
          totalPages: Math.ceil(filesTotal / limit)
        };

        totalResults += filesTotal;
      } catch (error) {
        console.error("Error searching files:", error);
        results.files = {
          total: 0,
          data: [],
          error: "Failed to search files"
        };
      }
    }

    // Search folders
    if (typesToSearch.includes("folders")) {
      try {
        const foldersPipeline = buildFoldersSearchPipeline(filters);
        const foldersCountPipeline = buildFoldersCountPipeline(filters);

        const [foldersData, foldersCountData] = await Promise.all([
          Form.aggregate(foldersPipeline),
          Form.aggregate(foldersCountPipeline)
        ]);

        const foldersTotal = foldersCountData.length > 0 ? foldersCountData[0].total : 0;

        results.folders = {
          total: foldersTotal,
          data: foldersData,
          page,
          limit,
          totalPages: Math.ceil(foldersTotal / limit)
        };

        totalResults += foldersTotal;
      } catch (error) {
        console.error("Error searching folders:", error);
        results.folders = {
          total: 0,
          data: [],
          error: "Failed to search folders"
        };
      }
    }

    // Search documents
    if (typesToSearch.includes("documents")) {
      try {
        const documentsPipeline = buildDocumentsSearchPipeline(filters);
        const documentsCountPipeline = buildDocumentsCountPipeline(filters);

        const [documentsData, documentsCountData] = await Promise.all([
          Form.aggregate(documentsPipeline),
          Form.aggregate(documentsCountPipeline)
        ]);

        const documentsTotal = documentsCountData.length > 0 ? documentsCountData[0].total : 0;

        results.documents = {
          total: documentsTotal,
          data: documentsData,
          page,
          limit,
          totalPages: Math.ceil(documentsTotal / limit)
        };

        totalResults += documentsTotal;
      } catch (error) {
        console.error("Error searching documents:", error);
        results.documents = {
          total: 0,
          data: [],
          error: "Failed to search documents"
        };
      }
    }

    // Search templates
    if (typesToSearch.includes("templates")) {
      try {
        const templatesPipeline = buildTemplatesSearchPipeline(filters);
        const templatesCountPipeline = buildTemplatesCountPipeline(filters);

        const [templatesData, templatesCountData] = await Promise.all([
          Form.aggregate(templatesPipeline),
          Form.aggregate(templatesCountPipeline)
        ]);

        const templatesTotal = templatesCountData.length > 0 ? templatesCountData[0].total : 0;

        results.templates = {
          total: templatesTotal,
          data: templatesData,
          page,
          limit,
          totalPages: Math.ceil(templatesTotal / limit)
        };

        totalResults += templatesTotal;
      } catch (error) {
        console.error("Error searching templates:", error);
        results.templates = {
          total: 0,
          data: [],
          error: "Failed to search templates"
        };
      }
    }

    return res.status(STATUS_CODES.SUCCESS).json({
      message: "Search completed successfully",
      results,
      totalResults,
      query: searchQuery || null,
      filters: {
        types: typesToSearch,
        assignedTo,
        createdBy,
        status,
        startDate,
        endDate,
        designation
      }
    });
  } catch (error) {
    console.error("Global search error:", error);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: "An error occurred while searching",
      error: error.message
    });
  }
};

/**
 * Get unique designations for company (for dropdown filters)
 * GET /api/search/designations
 */
const getDesignations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch user from database to get companyId
    const user = await findUser({ _id: userId });

    if (!user) {
      return res.status(STATUS_CODES.NOT_FOUND).json({
        message: "User not found"
      });
    }

    const companyId = user.companyId;

    // Get unique designations using aggregation
    const pipeline = getUniqueDesignationsQuery(companyId);
    const results = await User.aggregate(pipeline);

    // Extract designations array from results
    const designations = results.map(item => item.designation);

    return res.status(STATUS_CODES.SUCCESS).json({
      message: "Designations fetched successfully",
      designations,
      total: designations.length
    });
  } catch (error) {
    console.error("Get designations error:", error);
    return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: "An error occurred while fetching designations",
      error: error.message
    });
  }
};

module.exports = {
  globalSearch,
  getDesignations
};
