const { findChannel } = require("../models/channelModel");
const {
  updateChannelTab,
  findChannelTab,
  getAllTabs,
  createChannelTab,
  deleteChannelTab,
} = require("../models/channelTabsModel");
const { generateResponse, parseBody } = require("../utils");
const mongoose = require("mongoose");
const { STATUS_CODES } = require("../utils/constants");
const {
  getAllTabsOfMemberInChannelQuery,
  getAllTabMembersQuery,
  getTabMembersPaginatedQuery,
} = require("./queries/channelTabsQuery");
const { findCompany } = require("../models/companyModel");
const { findUser } = require("../models/userModel");
const {
  getAdminsAndMergeMembers,
} = require("./helpers/channelTabs/channelTabs.helper");

exports.addMembersToChannelTab = async (req, res, next) => {
  try {
    const { channelId, assignments } = parseBody(req.body);
    const requestingUserId = req.user.id; // Get ID of user making the request

    // Get current user to check their company
    const currentUser = await findUser({ _id: requestingUserId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const channel = await findChannel({ _id: channelId });
    if (!channel)
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });

    // Security Check: Verify the channel belongs to the user's company
    if (channel.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only manage tabs from channels in your own company",
      });
    }

    // Check if requesting user is the channel creator
    if (channel.createdBy.toString() !== requestingUserId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "Only channel creator can add members",
      });
    }

    // Get company details for domain check
    const company = await findCompany({ _id: channel.companyId });
    if (!company) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Company not found",
      });
    }

    try {
      // First validate all tabs and check for duplicates
      const validationPromises = assignments.map(async (assignment) => {
        const { tabId, memberids } = assignment;

        // Validate tab exists
        const tab = await findChannelTab({ _id: tabId });
        if (!tab) {
          throw new Error(`Tab with ID ${tabId} not found`);
        }

        // Validate each user in memberids
        for (const memberId of memberids) {
          const user = await findUser({ _id: memberId });
          if (!user) {
            throw new Error(`User with ID ${memberId} not found`);
          }

          // Check if user is active
          if (!user.isActive) {
            throw new Error(`Cannot add inactive user: ${user.email}`);
          }

          // Check user's domain
          const userDomain = user.email.split("@")[1];
          if (userDomain !== company.domain) {
            throw new Error(
              `User ${user.email} domain does not match company domain`
            );
          }

          // Check if user is already a member
          const existingMembers = tab.members || [];
          if (
            existingMembers.some((id) => id.toString() === memberId.toString())
          ) {
            throw new Error(
              `User ${user.email} is already a member of this tab`
            );
          }
        }

        return { tabId, memberids };
      });

      // Wait for all validations to complete
      const validatedAssignments = await Promise.all(validationPromises);

      // If we get here, all validations passed, so we can do updates in parallel
      const updatePromises = validatedAssignments.map(
        ({ tabId, memberids }) => {
          return updateChannelTab(
            { _id: tabId },
            { $push: { members: { $each: memberids } } }
          );
        }
      );

      // Wait for all updates to complete
      await Promise.all(updatePromises);

      return generateResponse(
        null,
        "Members added to tabs successfully",
        res,
        STATUS_CODES.SUCCESS
      );
    } catch (error) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Failed to add members: ${error.message}`,
      });
    }
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

//get all tabs of a channel in which the user is a member
exports.getAllTabsOfChannel = async (req, res, next) => {
  try {
    const { channelId, page, limit } = req.query;
    const userId = req.user.id; // Get the current user's ID

    // Get current user to check their company
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    const channel = await findChannel({ _id: channelId });
    if (!channel)
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });

    // Security Check: Verify the channel belongs to the user's company
    if (channel.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only access tabs from channels in your own company",
      });
    }

    // Use the query to get only tabs where the user is a member
    const query = getAllTabsOfMemberInChannelQuery(channelId, userId);
    const tabs = await getAllTabs({
      query,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 10,
      responseKey: "tabs",
      sort: { sortOrder: 1, createdAt: -1 }, // Sort by custom order first, then by creation date
    });

    return generateResponse(
      tabs,
      "Tabs fetched successfully",
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

// get all members of a tab
exports.getAllTabMembers = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const { page, limit } = req.query;
    const userId = req.user.id;

    // Get current user to check their company
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find the tab
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    // Security Check: Verify the tab belongs to the user's company
    if (tab.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only access tabs from your own company",
      });
    }

    // Check if the requesting user is a member of the tab
    if (!tab.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Get paginated members
    const query = getTabMembersPaginatedQuery(tabId);
    const result = await getAllTabs({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "members",
    });

    return generateResponse(
      result,
      "Tab members fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getAllTabMembers:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// create a new tab
exports.createNewChannelTab = async (req, res, next) => {
  try {
    const { tabName, channelId, isPrivate } = parseBody(req.body);
    const userId = req.user.id;

    // Get current user to check their company
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // find channel
    const channel = await findChannel({ _id: channelId });
    if (!channel)
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });

    // Security Check: Verify the channel belongs to the user's company
    if (channel.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only create tabs in channels from your own company",
      });
    }

    // Get all company admins and merge with creator (avoiding duplicates)
    const allMembers = await getAdminsAndMergeMembers(channel.companyId, [
      userId,
    ]);

    // create channel tab
    const channelTabBody = {
      channelId,
      tabName,
      members: allMembers,
      createdBy: userId,
      companyId: channel.companyId,
      isPrivate,
    };
    const newChannelTab = await createChannelTab(channelTabBody);
    return generateResponse(
      newChannelTab,
      "New channel tab successfully created",
      res,
      STATUS_CODES.CREATED
    );
  } catch (err) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: err?.message,
    });
  }
};

// Create multiple selected tabs for a channel
exports.createSelectedChannelTabs = async (req, res, next) => {
  try {
    const { channelId, tabs } = parseBody(req.body);
    const userId = req.user.id;

    // Get current user to check their company
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find and validate channel
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Security Check: Verify the channel belongs to the user's company
    if (channel.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only create tabs in channels from your own company",
      });
    }

    // Validate tabs array
    if (!tabs || !Array.isArray(tabs) || tabs.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Tabs array is required and must not be empty",
      });
    }

    // Get valid tab names from constants
    const validTabNames = Object.values(
      require("../utils/constants").DEFAULT_TABS
    );

    // Validate all tab names first
    const invalidTabNames = tabs
      .map((tab) => tab.tabName)
      .filter((name) => !validTabNames.includes(name));

    if (invalidTabNames.length > 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Invalid tab names: ${invalidTabNames.join(
          ", "
        )}. Must be one of: ${validTabNames.join(", ")}`,
      });
    }

    // Check for existing default tabs with the same names in this channel
    const requestedTabNames = tabs.map((tab) => tab.tabName);
    const existingTabs = await getAllTabs({
      query: [
        {
          $match: {
            channelId: {
              $eq: require("mongoose").Types.ObjectId.createFromHexString(
                channelId
              ),
            },
            tabName: { $in: requestedTabNames },
            isDefault: true,
          },
        },
      ],
      page: 1,
      limit: 100,
      responseKey: "tabs",
    });

    const existingTabNames = existingTabs.tabs.map((tab) => tab.tabName);

    // Filter out tabs that already exist
    const tabsToCreate = tabs.filter(
      (tab) => !existingTabNames.includes(tab.tabName)
    );
    const duplicateTabs = tabs.filter((tab) =>
      existingTabNames.includes(tab.tabName)
    );

    const createdTabs = [];
    const errors = [];

    // Add errors for duplicate tabs
    duplicateTabs.forEach((tab) => {
      errors.push(`Tab "${tab.tabName}" already exists in this channel`);
    });

    // Process only new tabs
    for (const tabData of tabsToCreate) {
      try {
        const { tabName, isPrivate, members: privateMembers = [] } = tabData;

        let tabMembers = [];

        if (isPrivate) {
          // For private tabs: Add admins + specific users from request
          tabMembers = await getAdminsAndMergeMembers(
            channel.companyId,
            privateMembers
          );
        } else {
          // For public tabs: Add all channel members
          tabMembers = channel.members || [];
        }

        // Create tab body
        const channelTabBody = {
          channelId,
          tabName,
          members: tabMembers,
          createdBy: userId,
          companyId: channel.companyId,
          isPrivate: isPrivate ?? false,
          isDefault: true, // These are considered default tabs
        };

        // Create the tab
        const newTab = await createChannelTab(channelTabBody);
        createdTabs.push(newTab);
      } catch (tabError) {
        console.error(`Error creating tab ${tabData?.tabName}:`, tabError);
        errors.push(
          `Failed to create tab ${tabData?.tabName}: ${tabError.message}`
        );
      }
    }

    // Prepare response
    const response = {
      createdTabs,
      totalCreated: createdTabs.length,
      totalRequested: tabs.length,
      alreadyExisted: duplicateTabs.length,
      existingTabNames: existingTabNames,
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    // Determine response status and message
    if (createdTabs.length === 0 && duplicateTabs.length > 0) {
      // All tabs already exist
      return generateResponse(
        response,
        `All requested tabs already exist in this channel`,
        res,
        STATUS_CODES.CONFLICT
      );
    } else if (createdTabs.length === 0) {
      // No tabs created due to errors
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Failed to create any tabs",
        errors,
      });
    } else if (duplicateTabs.length > 0) {
      // Partial success - some created, some already existed
      const message = `${createdTabs.length} new tabs created successfully. ${duplicateTabs.length} tabs already existed.`;
      return generateResponse(
        response,
        message,
        res,
        STATUS_CODES.PARTIAL_CONTENT
      );
    } else {
      // All tabs created successfully
      return generateResponse(
        response,
        "All tabs created successfully",
        res,
        STATUS_CODES.CREATED
      );
    }
  } catch (error) {
    console.error("Error in createSelectedChannelTabs:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to create channel tabs",
    });
  }
};

// Toggle channel tab (activate/deactivate)
exports.toggleChannelTab = async (req, res, next) => {
  try {
    const { channelId, tabName, isPrivate = false } = parseBody(req.body);
    const userId = req.user.id;

    // Get current user to check their company
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find and validate channel
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Security Check: Verify the channel belongs to the user's company
    if (channel.companyId.toString() !== currentUser.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only manage tabs in channels from your own company",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You must be a member of the channel to manage tabs",
      });
    }

    // Validate tab name
    const validTabNames = Object.values(
      require("../utils/constants").DEFAULT_TABS
    );
    if (!validTabNames.includes(tabName)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Invalid tab name. Must be one of: ${validTabNames.join(", ")}`,
      });
    }

    // Check if tab already exists
    const existingTab = await findChannelTab({
      channelId: channelId,
      tabName: tabName,
      isDefault: true,
    });

    let result;
    let action;

    if (existingTab) {
      // Tab exists - DEACTIVATE (delete)
      result = await deleteChannelTab({
        _id: existingTab._id,
      });
      
      action = "deactivated";
      
      const responseData = {
        tabId: existingTab._id,
        tabName: tabName,
        action: action,
        isPrivate: existingTab.isPrivate,
        channelId: channelId,
      };

      return generateResponse(
        responseData,
        `Tab "${tabName}" deactivated successfully`,
        res,
        STATUS_CODES.SUCCESS
      );
    } else {
      // Tab doesn't exist - ACTIVATE (create)
      let tabMembers = [];
      
      if (!isPrivate) {
        // For public tabs, add all channel members
        tabMembers = [...channel.members];
      } else {
        // For private tabs, start with creator as the initial member
        tabMembers = [userId];
      }

      const newTab = await createChannelTab({
        channelId: channelId,
        tabName: tabName,
        isDefault: true,
        isPrivate: isPrivate,
        members: tabMembers,
        createdBy: userId,
        companyId: currentUser.companyId,
        tabDescription: `Default ${tabName} tab`,
      });

      action = "activated";

      const responseData = {
        tabId: newTab._id,
        tabName: newTab.tabName,
        action: action,
        isPrivate: newTab.isPrivate,
        channelId: channelId,
        members: newTab.members,
      };

      return generateResponse(
        responseData,
        `Tab "${tabName}" activated successfully`,
        res,
        STATUS_CODES.SUCCESS
      );
    }
  } catch (error) {
    console.error("Error in toggleChannelTab:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to toggle channel tab",
    });
  }
};
