"use strict";

const { generateResponse, parseBody } = require("../utils");
const { STATUS_CODES, INDEFINITE_MUTE_DATE, isIndefiniteMute } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findManyChannels } = require("../models/channelModel");
const {
  createOrUpdateMutePreferences,
  findUserMutePreferences,
  updateUserMutePreferences,
  deleteUserMutePreferences,
  upsertChannelMute,
  removeChannelMute,
  findChannelMuteEntry,
} = require("../models/userMutePreferencesModel");
const { findChannel } = require("../models/channelModel");

// Helper function to calculate mute duration in milliseconds
const getMuteDurationMs = (duration) => {
  const durations = {
    "30min": 30 * 60 * 1000, // 30 minutes
    "1hour": 60 * 60 * 1000, // 1 hour
    "2hours": 2 * 60 * 60 * 1000, // 2 hours
    "4hours": 4 * 60 * 60 * 1000, // 4 hours
    "8hours": 8 * 60 * 60 * 1000, // 8 hours
    "24hours": 24 * 60 * 60 * 1000, // 24 hours (1 day)
    "168hours": 168 * 60 * 60 * 1000, // 168 hours (1 week)
  };
  return durations[duration] || durations["1hour"]; // Default to 1 hour
};

// Helper function to format time remaining
const getTimeRemaining = (muteUntil) => {
  const now = new Date();
  const diff = muteUntil - now;

  if (diff <= 0) return "Expired";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
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

// ─── Per-channel socket helpers ───────────────────────────────────────────────

const removeUserFromChannelRoom = (userId, channelId, io) => {
  try {
    const userRoom = `user:${userId}`;
    const socketsInRoom = io.sockets.adapter.rooms.get(userRoom);

    if (socketsInRoom) {
      socketsInRoom.forEach((socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.leave(`channel:${channelId}`);
          socket.emit("channel-mute-status", {
            isMuted: true,
            channelId,
            message: "Channel notifications muted",
          });
        }
      });
    }
  } catch (error) {
    console.error("Error removing user from channel room:", error);
  }
};

const addUserToChannelRoom = (userId, channelId, io) => {
  try {
    const userRoom = `user:${userId}`;
    const socketsInRoom = io.sockets.adapter.rooms.get(userRoom);

    if (socketsInRoom) {
      socketsInRoom.forEach((socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.join(`channel:${channelId}`);
          socket.emit("channel-unmute-complete", {
            isMuted: false,
            channelId,
            message: "Channel notifications resumed",
          });
        }
      });
    }
  } catch (error) {
    console.error("Error adding user to channel room:", error);
  }
};

// ─── Per-channel mute endpoints ───────────────────────────────────────────────

/**
 * Mute notifications for a specific channel
 * POST /api/notifications/channels/:channelId/mute
 */
exports.muteChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { duration } = parseBody(req.body);
    const userId = req.user.id;

    // Verify channel exists and user is a member
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({ statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" });
    }
    const isMember = channel.members.some((m) => m.toString() === userId);
    if (!isMember) {
      return next({ statusCode: STATUS_CODES.FORBIDDEN, message: "You are not a member of this channel" });
    }

    // Calculate muteUntil (indefinite = far-future sentinel date)
    const muteUntil = duration ? new Date(Date.now() + getMuteDurationMs(duration)) : INDEFINITE_MUTE_DATE;

    await upsertChannelMute(userId, channelId, muteUntil);

    // Remove user's socket from channel room
    const io = req.app.get("io");
    if (io) removeUserFromChannelRoom(userId, channelId, io);

    const indefinite = isIndefiniteMute(muteUntil);

    return generateResponse(
      {
        channelId,
        isMuted: true,
        muteUntil: indefinite ? null : muteUntil.toISOString(),
        timeRemaining: indefinite ? "Until unmuted" : getTimeRemaining(muteUntil),
      },
      "Channel notifications muted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in muteChannel:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Unmute notifications for a specific channel
 * POST /api/notifications/channels/:channelId/unmute
 */
exports.unmuteChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;

    const entry = await findChannelMuteEntry(userId, channelId);
    if (!entry) {
      return generateResponse(
        { channelId, isMuted: false },
        "Channel is not muted",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    await removeChannelMute(userId, channelId);

    // Re-add user's socket to channel room
    const io = req.app.get("io");
    if (io) addUserToChannelRoom(userId, channelId, io);

    return generateResponse(
      { channelId, isMuted: false, resumedAt: new Date().toISOString() },
      "Channel notifications resumed successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in unmuteChannel:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

/**
 * Get mute status for a specific channel
 * GET /api/notifications/channels/:channelId/mute-status
 */
exports.getChannelMuteStatus = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;

    const entry = await findChannelMuteEntry(userId, channelId);

    if (!entry) {
      return generateResponse(
        { channelId, isMuted: false, muteUntil: null, timeRemaining: null },
        "Channel is not muted",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Auto-clean if expired (skip sentinel dates — those are indefinite)
    if (entry.muteUntil && !isIndefiniteMute(entry.muteUntil) && entry.muteUntil <= new Date()) {
      await removeChannelMute(userId, channelId);
      return generateResponse(
        { channelId, isMuted: false, muteUntil: null, timeRemaining: null },
        "Channel mute has expired",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    const indefinite = isIndefiniteMute(entry.muteUntil);

    return generateResponse(
      {
        channelId,
        isMuted: true,
        muteUntil: indefinite ? null : (entry.muteUntil?.toISOString() || null),
        timeRemaining: indefinite ? "Until unmuted" : (entry.muteUntil ? getTimeRemaining(entry.muteUntil) : "Until unmuted"),
        mutedAt: entry.mutedAt?.toISOString(),
      },
      "Channel mute status retrieved",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getChannelMuteStatus:", error);
    return next({ statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR, message: error?.message });
  }
};

// ─── Global mute endpoints ────────────────────────────────────────────────────

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
