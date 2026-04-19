"use strict";

const cron = require("node-cron");
const {
  findExpiredMutePreferences,
  updateUserMutePreferences,
  findExpiredChannelMutes,
  removeChannelMute,
} = require("../models/userMutePreferencesModel");
const {
  findExpiredStatuses,
  updateUserStatus
} = require("../models/userStatusModel");
const { PasswordReset } = require("../models/passwordResetModel");

// Helper function to add user back to socket rooms
const addUserToSocketRooms = async (userId, mutedChannels, io) => {
  try {
    const userRoom = `user:${userId}`;
    const socketsInRoom = io.sockets.adapter.rooms.get(userRoom);
    
    if (socketsInRoom) {
      socketsInRoom.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          // Rejoin user room
          socket.join(`user:${userId}`);
          
          // Rejoin all previously muted channels
          mutedChannels.forEach(channelId => {
            socket.join(`channel:${channelId}`);
          });
          
          // Emit unmute status
          socket.emit('auto-unmute', {
            isMuted: false,
            message: 'Your mute period has expired. Notifications have been automatically resumed.',
            rejoinedChannels: mutedChannels.length,
            unmuteReason: 'expired'
          });
        }
      });
    }
  } catch (error) {
    console.error('Error adding user back to socket rooms during auto-unmute:', error);
  }
};

// Auto-unmute expired users
const autoUnmuteExpiredUsers = async (io) => {
  try {
    console.log('Running auto-unmute check...');
    
    const expiredMutePrefs = await findExpiredMutePreferences();
    
    if (expiredMutePrefs.length === 0) {
      console.log('No expired mute preferences found');
      return;
    }
    
    console.log(`Found ${expiredMutePrefs.length} expired mute preferences`);
    
    for (const mutePrefs of expiredMutePrefs) {
      try {
        const { userId, mutedChannels } = mutePrefs;
        
        // Update database to unmute user
        await updateUserMutePreferences(
          { userId },
          {
            isMuted: false,
            muteUntil: null,
            mutedChannels: [],
            updatedAt: new Date(),
          }
        );
        
        // Add user back to socket rooms if io is available
        if (io) {
          await addUserToSocketRooms(userId, mutedChannels, io);
        }
        
        console.log(`Auto-unmuted user: ${userId}, rejoined ${mutedChannels.length} channels`);
      } catch (error) {
        console.error(`Error auto-unmuting user ${mutePrefs.userId}:`, error);
      }
    }
    
    console.log('Auto-unmute check completed');
  } catch (error) {
    console.error('Error in auto-unmute cron job:', error);
  }
};

// Auto-unmute expired per-channel mutes
const autoUnmuteExpiredChannels = async (io) => {
  try {
    const docs = await findExpiredChannelMutes();
    if (docs.length === 0) return;

    console.log(`Auto-unmuting expired channel mutes for ${docs.length} user(s)`);

    for (const prefs of docs) {
      const userId = prefs.userId;
      const now = new Date();

      // Identify only the expired entries (skip indefinite muteUntil: null)
      const expiredEntries = prefs.channelMutes.filter(
        (m) => m.muteUntil && m.muteUntil <= now
      );

      for (const entry of expiredEntries) {
        const channelId = entry.channelId.toString();
        try {
          await removeChannelMute(userId, channelId);

          if (io) {
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
                    message: "Channel mute period has expired. Notifications resumed.",
                    unmuteReason: "expired",
                  });
                }
              });
            }
          }

          console.log(`Auto-unmuted channel ${channelId} for user ${userId}`);
        } catch (err) {
          console.error(`Error auto-unmuting channel ${channelId} for user ${userId}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("Error in auto-unmute channel cron job:", error);
  }
};

// Auto-clear expired user statuses
const autoClearExpiredStatuses = async () => {
  try {
    console.log('Running status auto-clear check...');
    
    const expiredStatuses = await findExpiredStatuses();
    
    if (expiredStatuses.length === 0) {
      console.log('No expired user statuses found');
      return;
    }
    
    console.log(`Found ${expiredStatuses.length} expired user statuses`);
    
    for (const status of expiredStatuses) {
      try {
        // Clear the expired status
        await updateUserStatus(
          { userId: status.userId },
          {
            statusType: null,
            statusMessage: null,
            statusEmoji: null,
            expiresAt: null,
            isActive: false,
            updatedAt: new Date(),
          }
        );
        
        console.log(`Auto-cleared expired status for user: ${status.userId}, status was: ${status.statusType}`);
      } catch (error) {
        console.error(`Error auto-clearing status for user ${status.userId}:`, error);
      }
    }
    
    console.log('Status auto-clear check completed');
  } catch (error) {
    console.error('Error in auto-clear status cron job:', error);
  }
};

// Auto-cleanup expired password reset codes (runs every 5 minutes)
const cleanupExpiredPasswordResets = async () => {
  try {
    console.log('Running password reset cleanup check...');
    
    // Delete all expired unused codes
    const expiredResult = await PasswordReset.deleteMany({
      expiresAt: { $lt: new Date() },
      isUsed: false
    });
    
    if (expiredResult.deletedCount > 0) {
      console.log(`Deleted ${expiredResult.deletedCount} expired password reset codes`);
    } else {
      console.log('No expired password reset codes found');
    }
    
    console.log('Password reset cleanup check completed');
  } catch (error) {
    console.error('Error in password reset cleanup cron job:', error);
  }
};

// Auto-cleanup old used password reset codes (runs daily)
const cleanupUsedPasswordResets = async () => {
  try {
    console.log('Running used password reset cleanup check...');
    
    // Delete used codes older than 24 hours
    const usedResult = await PasswordReset.deleteMany({
      isUsed: true,
      updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    if (usedResult.deletedCount > 0) {
      console.log(`Deleted ${usedResult.deletedCount} old used password reset codes`);
    } else {
      console.log('No old used password reset codes found');
    }
    
    console.log('Used password reset cleanup check completed');
  } catch (error) {
    console.error('Error in used password reset cleanup cron job:', error);
  }
};

// Initialize cron jobs
const initializeCronJobs = (io) => {
  // Check for expired global mute preferences every minute
  const autoUnmuteJob = cron.schedule('* * * * *', () => {
    autoUnmuteExpiredUsers(io);
    autoUnmuteExpiredChannels(io);
  }, {
    scheduled: false,
    timezone: "UTC"
  });

  // Check for expired user statuses every 10 minutes
  const autoClearStatusJob = cron.schedule('*/10 * * * *', () => {
    autoClearExpiredStatuses();
  }, {
    scheduled: false,
    timezone: "UTC"
  });

  // Cleanup expired password reset codes every 5 minutes
  const passwordResetCleanupJob = cron.schedule('*/5 * * * *', () => {
    cleanupExpiredPasswordResets();
  }, {
    scheduled: false,
    timezone: "UTC"
  });

  // Cleanup used password reset codes daily at 2 AM UTC
  const usedPasswordResetCleanupJob = cron.schedule('0 2 * * *', () => {
    cleanupUsedPasswordResets();
  }, {
    scheduled: false,
    timezone: "UTC"
  });

  // Start the cron jobs
  autoUnmuteJob.start();
  autoClearStatusJob.start();
  passwordResetCleanupJob.start();
  usedPasswordResetCleanupJob.start();
  console.log('✅ Auto-unmute cron job initialized (runs every minute)');
  console.log('✅ Auto-clear status cron job initialized (runs every 10 minutes)');
  console.log('✅ Password reset cleanup cron job initialized (runs every 5 minutes)');
  console.log('✅ Used password reset cleanup cron job initialized (runs daily at 2 AM UTC)');

  return {
    autoUnmuteJob,
    autoClearStatusJob,
    passwordResetCleanupJob,
    usedPasswordResetCleanupJob,
    // Method to manually trigger jobs (useful for testing)
    triggerAutoUnmute: () => autoUnmuteExpiredUsers(io),
    triggerAutoUnmuteChannels: () => autoUnmuteExpiredChannels(io),
    triggerAutoClearStatus: () => autoClearExpiredStatuses(),
    triggerPasswordResetCleanup: () => cleanupExpiredPasswordResets(),
    triggerUsedPasswordResetCleanup: () => cleanupUsedPasswordResets()
  };
};

module.exports = {
  initializeCronJobs,
  autoUnmuteExpiredUsers,
  autoUnmuteExpiredChannels,
  autoClearExpiredStatuses,
  cleanupExpiredPasswordResets,
  cleanupUsedPasswordResets
};