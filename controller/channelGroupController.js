"use strict";

const { parseBody, generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { createChannelGroup, findChannelGroup, updateChannelGroup } = require("../models/channelGroupModel");
const { findManyChannels } = require("../models/channelModel");

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

    // Find the channel group
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

    // Validate that all channels exist and belong to the same company
    const channels = await findManyChannels({ 
      _id: { $in: channelIds },
      companyId: user.companyId 
    });

    if (channels.length !== channelIds.length) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "One or more channels not found or don't belong to your company",
      });
    }

    // Update the channel group with new channel IDs
    const updatedChannelGroup = await updateChannelGroup(
      { _id: channelGroupId },
      { channelIds: channelIds }
    );

    return generateResponse(
      {
        channelGroup: updatedChannelGroup,
      },
      "Channels assigned to group successfully",
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
