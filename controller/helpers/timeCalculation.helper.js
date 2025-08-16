"use strict";

/**
 * Extract time components (hours, minutes, seconds) from a Date object
 * @param {Date} date - The date object
 * @returns {Object} - { hours, minutes, seconds }
 */
const extractTimeComponents = (date) => {
  return {
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
  };
};

/**
 * Create a new date with specific time on a given date
 * @param {Date} baseDate - The base date
 * @param {number} hours - Hours (0-23)
 * @param {number} minutes - Minutes (0-59)
 * @param {number} seconds - Seconds (0-59)
 * @returns {Date} - New date with specified time
 */
const createDateWithTime = (baseDate, hours, minutes, seconds) => {
  const newDate = new Date(baseDate);
  newDate.setHours(hours, minutes, seconds, 0);
  return newDate;
};

/**
 * Calculate days difference between two dates
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date  
 * @returns {number} - Number of days difference
 */
const calculateDaysDifference = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Reset time to 00:00:00 for pure day calculation
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  
  const diffTime = end - start;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Handle start time change - adjust end time if needed
 * @param {Date} originalStartTime - Original start time
 * @param {Date} originalEndTime - Original end time
 * @param {string} newStartTimeString - New start time in HH:MM format
 * @returns {Object} - { newStartTime, newEndTime, daysAdded }
 */
const handleStartTimeChange = (originalStartTime, originalEndTime, newStartTimeString) => {
  const [newHours, newMinutes] = newStartTimeString.split(':').map(Number);
  
  // Create new start time preserving original date, seconds, and milliseconds
  const newStartTime = new Date(originalStartTime);
  newStartTime.setUTCHours(newHours, newMinutes, originalStartTime.getUTCSeconds(), originalStartTime.getUTCMilliseconds());
  
  // Keep the original end time unchanged initially
  let newEndTime = new Date(originalEndTime);
  let daysAdded = 0;
  
  // If new start time is >= end time, add a day to end time
  if (newStartTime >= newEndTime) {
    newEndTime.setUTCDate(newEndTime.getUTCDate() + 1);
    daysAdded = 1;
  }
  
  // Calculate actual days added compared to original
  const originalDays = calculateDaysDifference(originalStartTime, originalEndTime);
  const newDays = calculateDaysDifference(newStartTime, newEndTime);
  daysAdded = newDays - originalDays;
  
  return {
    newStartTime,
    newEndTime,
    daysAdded
  };
};

/**
 * Handle end time change - adjust if end time is before start time
 * @param {Date} startTime - Current start time
 * @param {Date} originalEndTime - Original end time
 * @param {string} newEndTimeString - New end time in HH:MM format
 * @returns {Object} - { newEndTime, daysAdded }
 */
const handleEndTimeChange = (startTime, originalEndTime, newEndTimeString) => {
  const [newHours, newMinutes] = newEndTimeString.split(':').map(Number);
  
  // Create new end time preserving original date, seconds, and milliseconds
  let newEndTime = new Date(originalEndTime);
  newEndTime.setUTCHours(newHours, newMinutes, originalEndTime.getUTCSeconds(), originalEndTime.getUTCMilliseconds());
  
  let daysAdded = 0;
  
  // If new end time is <= start time, add a day to end time
  if (newEndTime <= startTime) {
    newEndTime.setUTCDate(newEndTime.getUTCDate() + 1);
    daysAdded = 1;
  }
  
  // Calculate actual days added compared to original
  const originalDays = calculateDaysDifference(startTime, originalEndTime);
  const newDays = calculateDaysDifference(startTime, newEndTime);
  daysAdded = newDays - originalDays;
  
  return {
    newEndTime,
    daysAdded
  };
};

/**
 * Parse total time string (HH:MM:SS) to seconds
 * @param {string} timeString - Time in HH:MM:SS format
 * @returns {number} - Total seconds
 */
const parseTimeStringToSeconds = (timeString) => {
  const [hours, minutes, seconds] = timeString.split(':').map(Number);
  return (hours * 3600) + (minutes * 60) + seconds;
};

/**
 * Convert seconds to HH:MM:SS format
 * @param {number} totalSeconds - Total seconds
 * @returns {string} - Time in HH:MM:SS format
 */
const formatSecondsToTimeString = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Handle total time change - adjust end time accordingly
 * @param {Date} startTime - Current start time
 * @param {Date} originalEndTime - Original end time
 * @param {string} newTotalTimeString - New total time in HH:MM:SS format
 * @returns {Object} - { newEndTime, daysAdded }
 */
const handleTotalTimeChange = (startTime, originalEndTime, newTotalTimeString) => {
  const newTotalSeconds = parseTimeStringToSeconds(newTotalTimeString);
  
  // Calculate new end time by adding total seconds to start time
  const newEndTime = new Date(startTime.getTime() + (newTotalSeconds * 1000));
  
  // Calculate days added compared to original
  const originalDays = calculateDaysDifference(startTime, originalEndTime);
  const newDays = calculateDaysDifference(startTime, newEndTime);
  const daysAdded = newDays - originalDays;
  
  return {
    newEndTime,
    daysAdded
  };
};

/**
 * Calculate total time in seconds between two dates
 * @param {Date} startTime - Start time
 * @param {Date} endTime - End time
 * @returns {number} - Total seconds
 */
const calculateTotalSeconds = (startTime, endTime) => {
  const diffMs = endTime - startTime;
  return Math.round(diffMs / 1000);
};

module.exports = {
  extractTimeComponents,
  createDateWithTime,
  calculateDaysDifference,
  handleStartTimeChange,
  handleEndTimeChange,
  parseTimeStringToSeconds,
  formatSecondsToTimeString,
  handleTotalTimeChange,
  calculateTotalSeconds
};