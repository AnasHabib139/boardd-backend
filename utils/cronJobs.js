"use strict";

const cron = require("node-cron");
const { 
  findExpiredMutePreferences, 
  updateUserMutePreferences 
} = require("../models/userMutePreferencesModel");

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

// Initialize cron jobs
const initializeCronJobs = (io) => {
  // Check for expired mute preferences every minute
  const autoUnmuteJob = cron.schedule('* * * * *', () => {
    autoUnmuteExpiredUsers(io);
  }, {
    scheduled: false,
    timezone: "UTC"
  });

  // Start the cron job
  autoUnmuteJob.start();
  console.log('✅ Auto-unmute cron job initialized (runs every minute)');

  return {
    autoUnmuteJob,
    // Method to manually trigger auto-unmute (useful for testing)
    triggerAutoUnmute: () => autoUnmuteExpiredUsers(io)
  };
};

module.exports = {
  initializeCronJobs,
  autoUnmuteExpiredUsers
};