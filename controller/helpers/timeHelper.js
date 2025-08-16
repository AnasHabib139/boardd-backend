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
 * @param {string} newStartTimeString - New start time in HH:MM format (user's local time)
 * @returns {Object} - { newStartTime, newEndTime, daysAdded }
 */
const handleStartTimeChange = (originalStartTime, originalEndTime, newStartTimeString) => {
  // Since DB stores UTC, but user provides local time, we need to work in UTC
  const originalStartMoment = moment.utc(originalStartTime);
  const [newHours, newMinutes] = newStartTimeString.split(':').map(Number);
  
  // Create new start time on same UTC date with the user's time
  const newStartTime = originalStartMoment.clone()
    .utc()
    .hours(newHours)
    .minutes(newMinutes)
    .seconds(0)
    .milliseconds(0);
  
  // Keep original end time initially
  let newEndTime = moment.utc(originalEndTime);
  let daysAdded = 0;
  
  // If new start time is after or equal to end time, move end time to next day
  if (newStartTime.isSameOrAfter(newEndTime)) {
    newEndTime = newEndTime.clone().add(1, 'day');
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
 * @param {string} newEndTimeString - New end time in HH:MM format (user's local time)
 * @returns {Object} - { newEndTime, daysAdded }
 */
const handleEndTimeChange = (startTime, originalEndTime, newEndTimeString) => {
  // Since DB stores UTC, but user provides local time, we need to work in UTC
  const originalEndMoment = moment.utc(originalEndTime);
  const startMoment = moment.utc(startTime);
  const [newHours, newMinutes] = newEndTimeString.split(':').map(Number);
  
  // Create new end time on same UTC date with the user's time
  let newEndTime = originalEndMoment.clone()
    .utc()
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
  
  // Calculate days difference from original
  const originalDays = moment.utc(originalEndTime).diff(startMoment, 'days');
  const newDays = newEndTime.diff(startMoment, 'days');
  daysAdded = newDays - originalDays;
  
  return {
    newEndTime: newEndTime.toDate(),
    daysAdded
  };
};

/**
 * Handle total time change - calculates new end time based on duration
 * @param {Date} startTime - Current start time
 * @param {string} newTotalTimeString - New total time in HH:MM:SS format
 * @returns {Object} - { newEndTime, daysAdded }
 */
const handleTotalTimeChange = (startTime, newTotalTimeString) => {
  const startMoment = moment(startTime);
  
  // Parse HH:MM:SS format
  const [hours, minutes, seconds] = newTotalTimeString.split(':').map(Number);
  const totalMinutes = (hours * 60) + minutes + (seconds / 60);
  
  // Calculate new end time
  const newEndTime = startMoment.clone().add(totalMinutes, 'minutes');
  
  // Calculate days added
  const daysAdded = newEndTime.diff(startMoment, 'days');
  
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
  parseUserTimeToUTC
};