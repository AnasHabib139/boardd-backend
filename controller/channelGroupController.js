"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES, UNASSIGNED_CHANNEL_GROUP_ID } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const {
  createChannelGroup,
  findChannelGroup,
  updateChannelGroup,
  getAllChannelGroups,
  deleteChannelGroup: removeChannelGroup,
} = require("../models/channelGroupModel");
const { findManyChannels } = require("../models/channelModel");
const {
  getAllChannelGroupsQuery,
} = require("./queries/channelGroupQueries");
const { findUserMutePreferences } = require("../models/userMutePreferencesModel");

/**
 * Create a new channel group
 */
exports.createChannelGroup = async (req, res, next) => {
  try {
    const { title } = parseBody(req.body);
    const userId = req.user.id;

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Create channel group with empty channelIds (will be populated via drag-drop)
    const channelGroup = await createChannelGroup({
      title,
      channelIds: [], // Start with empty array, channels will be added via drag-drop
      companyId: user.companyId,
      createdBy: userId,
    });

    return generateResponse(
      {
        channelGroup,
      },
      "Channel group created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createChannelGroup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Assign channels to a channel group
 */
exports.assignChannelsToGroup = async (req, res, next) => {
  try {
    const { channelIds, channelGroupId } = parseBody(req.body);
    const userId = req.user.id;

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    if (!user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must be associated with a company",
      });
    }

    // Check if this is the special "Unassigned" group ID
    const isUnassignedGroup = channelGroupId === UNASSIGNED_CHANNEL_GROUP_ID;

    // If not unassigned group, validate that the channel group exists
    if (!isUnassignedGroup) {
      const channelGroup = await findChannelGroup({ _id: channelGroupId });
      if (!channelGroup) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel group not found",
        });
      }

      // Check if channel group belongs to user's company
      if (channelGroup.companyId.toString() !== user.companyId.toString()) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You can only assign channels to groups in your own company",
        });
      }
    }

    // Handle null or empty channelIds (to empty the group)
    let validatedChannelIds = [];

    if (channelIds && channelIds.length > 0) {
      // Validate that all channels exist and belong to the same company
      const channels = await findManyChannels({
        _id: { $in: channelIds },
        companyId: user.companyId,
      });

      if (channels.length !== channelIds.length) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message:
            "One or more channels not found or don't belong to your company",
        });
      }

      validatedChannelIds = channelIds;
    }

    // If this is the unassigned group, remove channels from all groups
    if (isUnassignedGroup) {
      if (validatedChannelIds.length === 0) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Channel IDs are required to unassign channels",
        });
      }

      // Remove these channels from all groups
      const { ChannelGroupModel } = require("../models/channelGroupModel");
      const result = await ChannelGroupModel.updateMany(
        {
          companyId: user.companyId,
          channelIds: { $in: validatedChannelIds }
        },
        {
          $pull: { channelIds: { $in: validatedChannelIds } }
        }
      );

      return generateResponse(
        {
          channelsUnassigned: validatedChannelIds.length,
          groupsUpdated: result.modifiedCount,
        },
        `${validatedChannelIds.length} channel(s) unassigned successfully`,
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // For regular groups, remove channels from other groups first
    if (validatedChannelIds.length > 0) {
      const { ChannelGroupModel } = require("../models/channelGroupModel");
      await ChannelGroupModel.updateMany(
        {
          companyId: user.companyId,
          channelIds: { $in: validatedChannelIds },
          _id: { $ne: channelGroupId } // Don't update the target group
        },
        {
          $pull: { channelIds: { $in: validatedChannelIds } }
        }
      );
    }

    // Update the channel group with new channel IDs (empty array if null/empty)
    const updatedChannelGroup = await updateChannelGroup(
      { _id: channelGroupId },
      { channelIds: validatedChannelIds }
    );

    const message = validatedChannelIds.length > 0
      ? "Channels assigned to group successfully"
      : "Channel group emptied successfully";

    return generateResponse(
      {
        channelGroup: updatedChannelGroup,
      },
      message,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in assignChannelsToGroup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete a channel group
 */
exports.deleteChannelGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find the channel group
    const channelGroup = await findChannelGroup({ _id: groupId });
    if (!channelGroup) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel group not found",
      });
    }

    // Check if channel group belongs to user's company
    if (channelGroup.companyId.toString() !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You can only delete channel groups in your own company",
      });
    }

    // Delete the group (channels become "unassigned" automatically)
    await removeChannelGroup({ _id: groupId });

    return generateResponse(
      { channelGroup },
      "Channel group deleted successfully",
      res
    );
  } catch (error) {
    console.error("Error in deleteChannelGroup:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get all channel groups of user's company with populated channel information
 */
exports.getAllChannelGroups = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const userId = req.user.id;

    // Get user info
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    if (!user.companyId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "User must be associated with a company",
      });
    }

    // Fetch user's active per-channel mutes to inject into aggregation
    const now = new Date();
    const mutePrefs = await findUserMutePreferences({ userId });
    // Convert Mongoose subdocuments to plain objects so the MongoDB driver
    // serializes them correctly when used as literals inside the pipeline.
    const activeMutes = (mutePrefs?.channelMutes || [])
      .filter((m) => m.muteUntil === null || m.muteUntil > now)
      .map((m) => ({ channelId: m.channelId, muteUntil: m.muteUntil ?? null }));

    // Get the aggregation query filtered by user's channel membership
    const query = getAllChannelGroupsQuery(user.companyId.toString(), userId, activeMutes);

    // Fetch channel groups with pagination
    const result = await getAllChannelGroups({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "channelGroups",
    });

    return generateResponse(
      result,
      "Channel groups fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getAllChannelGroups:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
