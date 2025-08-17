"use strict";

const moment = require('moment');

/**
 * Time Helper using moment.js for simplified and accurate time calculations
 * 
 * IMPORTANT: User input time (e.g., "13:15") is treated as UTC time directly
 * No timezone conversion is performed - simple mapping "13:15" -> "13:15:00.000Z"
 * Database stores and works with UTC timestamps
 */

/**
 * Parse time string to moment object (today's date with specified time)
 * @param {string} timeString - Time in HH:MM format
 * @returns {moment.Moment} - Moment object
 */
const parseTimeString = (timeString) => {
  return moment(timeString, 'HH:mm');
};

/**
 * Format moment object to HH:MM string
 * @param {moment.Moment|Date} time - Moment object or Date
 * @returns {string} - Time in HH:MM format
 */
const formatTime = (time) => {
  return moment(time).format('HH:mm');
};

/**
 * Format duration in minutes to HH:MM:SS
 * @param {number} minutes - Duration in minutes
 * @returns {string} - Duration in HH:MM:SS format
 */
const formatDuration = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  const secs = Math.round((minutes % 1) * 60);
  
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Calculate duration between two times in minutes
 * @param {Date|moment.Moment} startTime - Start time
 * @param {Date|moment.Moment} endTime - End time
 * @returns {number} - Duration in minutes
 */
const calculateDurationMinutes = (startTime, endTime) => {
  const start = moment(startTime);
  const end = moment(endTime);
  
  return moment.duration(end.diff(start)).asMinutes();
};

/**
 * Handle start time change - creates new start time preserving date
 * @param {Date} originalStartTime - Original start time (UTC from DB)
 * @param {Date} originalEndTime - Original end time (UTC from DB)
 * @param {string} newStartTimeString - New start time in HH:MM format (treated as UTC)
 * @param {number} currentDaysAdded - Current days added stored in DB
 * @returns {Object} - { newStartTime, newEndTime, daysAdded }
 */
const handleStartTimeChange = (originalStartTime, originalEndTime, newStartTimeString, currentDaysAdded = 0) => {
  const originalStartMoment = moment.utc(originalStartTime);
  const [newHours, newMinutes] = newStartTimeString.split(':').map(Number);
  
  // Create new start time on same date as original start
  const newStartTime = originalStartMoment.clone()
    .utc()
    .hours(newHours)
    .minutes(newMinutes)
    .seconds(0)
    .milliseconds(0);
  
  // Reset end time to original date (subtract current days added to get base end time)
  const baseEndTime = moment.utc(originalEndTime).subtract(currentDaysAdded, 'days');
  
  // Apply the same time from original end time to the base date
  let newEndTime = baseEndTime.clone()
    .hours(moment.utc(originalEndTime).hours())
    .minutes(moment.utc(originalEndTime).minutes())
    .seconds(moment.utc(originalEndTime).seconds())
    .milliseconds(moment.utc(originalEndTime).milliseconds());
  
  let daysAdded = 0;
  
  // If new start time is after or equal to end time, move end time to next day
  if (newStartTime.isSameOrAfter(newEndTime)) {
    newEndTime = newEndTime.add(1, 'day');
    daysAdded = 1;
  }
  
  return {
    newStartTime: newStartTime.toDate(),
    newEndTime: newEndTime.toDate(),
    daysAdded
  };
};

/**
 * Handle end time change - creates new end time, adds day if needed
 * @param {Date} startTime - Current start time (UTC from DB)
 * @param {Date} originalEndTime - Original end time (UTC from DB)
 * @param {string} newEndTimeString - New end time in HH:MM format (treated as UTC)
 * @param {number} currentDaysAdded - Current days added stored in DB
 * @returns {Object} - { newEndTime, daysAdded }
 */
const handleEndTimeChange = (startTime, originalEndTime, newEndTimeString, currentDaysAdded = 0) => {
  const startMoment = moment.utc(startTime);
  const [newHours, newMinutes] = newEndTimeString.split(':').map(Number);
  
  // Start with the same date as start time (reset to same day)
  let newEndTime = startMoment.clone()
    .hours(newHours)
    .minutes(newMinutes)
    .seconds(0)
    .milliseconds(0);
  
  let daysAdded = 0;
  
  // If new end time is before or equal to start time, move to next day
  if (newEndTime.isSameOrBefore(startMoment)) {
    newEndTime = newEndTime.add(1, 'day');
    daysAdded = 1;
  }
  
  return {
    newEndTime: newEndTime.toDate(),
    daysAdded
  };
};

/**
 * Handle total time change - calculates new end time based on duration
 * @param {Date} startTime - Current start time (UTC from DB)
 * @param {string} newTotalTimeString - New total time in HH:MM:SS format
 * @returns {Object} - { newEndTime, daysAdded }
 */
const handleTotalTimeChange = (startTime, newTotalTimeString) => {
  const startMoment = moment.utc(startTime);
  
  // Parse HH:MM:SS format
  const [hours, minutes, seconds] = newTotalTimeString.split(':').map(Number);
  const totalMinutes = (hours * 60) + minutes + (seconds / 60);
  
  // Calculate new end time
  const newEndTime = startMoment.clone().add(totalMinutes, 'minutes');
  
  // Calculate days added - check if end time crosses midnight
  const startOfStartDay = startMoment.clone().startOf('day');
  const startOfEndDay = newEndTime.clone().startOf('day');
  const daysAdded = startOfEndDay.diff(startOfStartDay, 'days');
  
  return {
    newEndTime: newEndTime.toDate(),
    daysAdded
  };
};

/**
 * Validate time format HH:MM
 * @param {string} timeString - Time string to validate
 * @returns {boolean} - Whether the format is valid
 */
const isValidTimeFormat = (timeString) => {
  return moment(timeString, 'HH:mm', true).isValid();
};

/**
 * Convert Date to timezone-aware moment for display
 * @param {Date} date - Date object
 * @param {string} timezone - Timezone (optional, defaults to UTC)
 * @returns {moment.Moment} - Timezone-aware moment
 */
const toTimezone = (date, timezone = 'UTC') => {
  return moment.utc(date).tz(timezone);
};

/**
 * Parse user input time and convert to UTC Date
 * @param {string} timeString - Time in HH:MM format
 * @param {Date} baseDate - Base date to apply time to
 * @param {string} timezone - User's timezone
 * @returns {Date} - UTC Date object
 */
const parseUserTimeToUTC = (timeString, baseDate, timezone = 'UTC') => {
  const baseMoment = moment.utc(baseDate);
  const [hours, minutes] = timeString.split(':').map(Number);
  
  return baseMoment.clone()
    .hours(hours)
    .minutes(minutes)
    .seconds(0)
    .milliseconds(0)
    .toDate();
};

/**
 * Get ISO week start (Monday) and end (Sunday) dates for current week
 * @returns {Object} - { start: Date, end: Date }
 */
const getThisWeekRange = () => {
  const now = moment.utc();
  const startOfWeek = now.clone().startOf('isoWeek'); // Monday
  const endOfWeek = now.clone().endOf('isoWeek');     // Sunday
  
  return {
    start: startOfWeek.toDate(),
    end: endOfWeek.toDate()
  };
};

/**
 * Get ISO week start (Monday) and end (Sunday) dates for last week
 * @returns {Object} - { start: Date, end: Date }
 */
const getLastWeekRange = () => {
  const now = moment.utc();
  const lastWeekStart = now.clone().subtract(1, 'week').startOf('isoWeek'); // Monday of last week
  const lastWeekEnd = now.clone().subtract(1, 'week').endOf('isoWeek');     // Sunday of last week
  
  return {
    start: lastWeekStart.toDate(),
    end: lastWeekEnd.toDate()
  };
};

/**
 * Get week range based on filter type
 * @param {string} weekFilter - 'this_week' or 'last_week'
 * @returns {Object|null} - { start: Date, end: Date } or null if no filter
 */
const getWeekRange = (weekFilter) => {
  switch (weekFilter) {
    case 'this_week':
      return getThisWeekRange();
    case 'last_week':
      return getLastWeekRange();
    default:
      return null;
  }
};

module.exports = {
  parseTimeString,
  formatTime,
  formatDuration,
  calculateDurationMinutes,
  handleStartTimeChange,
  handleEndTimeChange,
  handleTotalTimeChange,
  isValidTimeFormat,
  toTimezone,
  parseUserTimeToUTC,
  getThisWeekRange,
  getLastWeekRange,
  getWeekRange
};