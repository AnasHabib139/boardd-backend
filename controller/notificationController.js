"use strict";

const { generateResponse, parseBody } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findManyChannels } = require("../models/channelModel");
const {
  createOrUpdateMutePreferences,
  findUserMutePreferences,
  updateUserMutePreferences,
  deleteUserMutePreferences,
} = require("../models/userMutePreferencesModel");

// Helper function to calculate mute duration in milliseconds
const getMuteDurationMs = (duration) => {
  const durations = {
    "30min": 30 * 60 * 1000, // 30 minutes
    "1hour": 60 * 60 * 1000, // 1 hour
    "2hours": 2 * 60 * 60 * 1000, // 2 hours
    "4hours": 4 * 60 * 60 * 1000, // 4 hours
    "8hours": 8 * 60 * 60 * 1000, // 8 hours
  };
  return durations[duration] || durations["1hour"]; // Default to 1 hour
};

// Helper function to format time remaining
const getTimeRemaining = (muteUntil) => {
  const now = new Date();
  const diff = muteUntil - now;

  if (diff <= 0) return "Expired";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

// Helper function to remove user from socket rooms
const removeUserFromSocketRooms = (userId, io) => {
  try {
    // Get all sockets for the user
    const userRoom = `user:${userId}`;
    const socketsInRoom = io.sockets.adapter.rooms.get(userRoom);

    if (socketsInRoom) {
      socketsInRoom.forEach((socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          // Leave all rooms except their own socket ID room
          const rooms = Array.from(socket.rooms);
          rooms.forEach((room) => {
            if (room !== socketId) {
              // Don't leave their own socket room
              socket.leave(room);
            }
          });

          // Emit mute status to the specific socket
          socket.emit("mute-status", {
            isMuted: true,
            message: "You have been muted from all notifications",
          });
        }
      });
    }
  } catch (error) {
    console.error("Error removing user from socket rooms:", error);
  }
};

// Helper function to add user back to socket rooms
const addUserToSocketRooms = async (userId, mutedChannels, io) => {
  try {
    const userRoom = `user:${userId}`;
    const socketsInRoom = io.sockets.adapter.rooms.get(userRoom);

    if (socketsInRoom) {
      socketsInRoom.forEach((socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          // Rejoin user room
          socket.join(`user:${userId}`);

          // Rejoin all previously muted channels
          mutedChannels.forEach((channelId) => {
            socket.join(`channel:${channelId}`);
          });

          // Emit unmute status
          socket.emit("unmute-complete", {
            isMuted: false,
            message: "Notifications have been resumed",
            rejoinedChannels: mutedChannels.length,
          });
        }
      });
    }
  } catch (error) {
    console.error("Error adding user back to socket rooms:", error);
  }
};

/**
 * Mute notifications for a specific duration
 */
exports.muteNotifications = async (req, res, next) => {
  try {
    const { duration } = parseBody(req.body);
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate duration
    const validDurations = ["30min", "1hour", "2hours", "4hours", "8hours"];
    if (!validDurations.includes(duration)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: `Invalid duration. Must be one of: ${validDurations.join(
          ", "
        )}`,
      });
    }

    // Get all channels user is a member of
    const userChannels = await findManyChannels({
      members: userId,
      isActive: true,
    });

    const channelIds = userChannels.map((channel) => channel._id);

    // Calculate mute until time
    const durationMs = getMuteDurationMs(duration);
    const muteUntil = new Date(Date.now() + durationMs);

    // Create or update mute preferences
    const mutePrefs = await createOrUpdateMutePreferences(
      { userId },
      {
        userId,
        isMuted: true,
        muteDuration: duration,
        muteUntil,
        mutedChannels: channelIds,
        updatedAt: new Date(),
      }
    );

    // Remove user from all socket rooms
    const io = req.app.get("io");
    if (io) {
      removeUserFromSocketRooms(userId, io);
    }

    return generateResponse(
      {
        isMuted: true,
        muteUntil: muteUntil.toISOString(),
        muteDuration: duration,
        mutedChannelsCount: channelIds.length,
        timeRemaining: getTimeRemaining(muteUntil),
      },
      "Notifications muted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in muteNotifications:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Manually unmute notifications
 */
exports.unmuteNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find user's mute preferences
    const mutePrefs = await findUserMutePreferences({ userId });
    if (!mutePrefs || !mutePrefs.isMuted) {
      return generateResponse(
        { isMuted: false },
        "User is not currently muted",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    const wasScheduledUntil = mutePrefs.muteUntil;
    const mutedChannels = mutePrefs.mutedChannels;

    // Clear mute settings
    await updateUserMutePreferences(
      { userId },
      {
        isMuted: false,
        muteUntil: null,
        mutedChannels: [],
        updatedAt: new Date(),
      }
    );

    // Add user back to socket rooms
    const io = req.app.get("io");
    if (io) {
      await addUserToSocketRooms(userId, mutedChannels, io);
    }

    return generateResponse(
      {
        isMuted: false,
        resumedAt: new Date().toISOString(),
        wasScheduledUntil: wasScheduledUntil?.toISOString(),
        rejoinedChannelsCount: mutedChannels.length,
      },
      "Notifications resumed successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in unmuteNotifications:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get current mute status
 */
exports.getMuteStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Find user's mute preferences
    const mutePrefs = await findUserMutePreferences({ userId });

    if (!mutePrefs || !mutePrefs.isMuted) {
      return generateResponse(
        {
          isMuted: false,
          muteUntil: null,
          timeRemaining: null,
          muteDuration: null,
          mutedChannelsCount: 0,
        },
        "User is not currently muted",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Check if mute has expired
    const now = new Date();
    if (mutePrefs.muteUntil && mutePrefs.muteUntil <= now) {
      // Mute has expired, auto-unmute
      await updateUserMutePreferences(
        { userId },
        {
          isMuted: false,
          muteUntil: null,
          mutedChannels: [],
          updatedAt: new Date(),
        }
      );

      return generateResponse(
        {
          isMuted: false,
          muteUntil: null,
          timeRemaining: "Expired - auto unmuted",
          muteDuration: null,
          mutedChannelsCount: 0,
        },
        "Mute period has expired - automatically unmuted",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    return generateResponse(
      {
        isMuted: mutePrefs.isMuted,
        muteUntil: mutePrefs.muteUntil?.toISOString(),
        timeRemaining: mutePrefs.muteUntil
          ? getTimeRemaining(mutePrefs.muteUntil)
          : null,
        muteDuration: mutePrefs.muteDuration,
        mutedChannelsCount: mutePrefs.mutedChannels.length,
      },
      "Mute status retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getMuteStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
