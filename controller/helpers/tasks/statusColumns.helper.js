"use strict";

const { PROJECT_COLUMN_TYPES } = require("../../../utils/constants");
const { findManyProjectStatusColumns } = require("../../../models/projectStatusColumnModel");

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone format
 */
const isValidPhone = (phone) => {
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
};

/**
 * Validate date format
 */
const isValidDate = (dateString) => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

/**
 * Validate location object
 */
const isValidLocation = (location) => {
  if (typeof location !== 'object' || !location) return false;

  // Must have address
  if (!location.address || typeof location.address !== 'string') return false;

  // Coordinates are optional but if provided must be valid
  if (location.coordinates) {
    const { latitude, longitude } = location.coordinates;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
    if (latitude < -90 || latitude > 90) return false;
    if (longitude < -180 || longitude > 180) return false;
  }

  return true;
};

/**
 * Validate signature object
 */
const isValidSignature = (signature) => {
  if (typeof signature !== 'object' || !signature) return false;

  return (
    signature.signatureData &&
    typeof signature.signatureData === 'string' &&
    signature.signedBy &&
    signature.signedAt &&
    signature.signerName &&
    isValidDate(signature.signedAt)
  );
};

/**
 * Validate voting object
 */
const isValidVoting = (voting) => {
  if (typeof voting !== 'object' || !voting) return false;

  return (
    Array.isArray(voting.votes) &&
    typeof voting.count === 'number' &&
    voting.count === voting.votes.length
  );
};

/**
 * Validate a single column value against its definition
 */
const validateColumnValue = (value, columnDefinition) => {
  const { columnType, columnKey, columnName, dropdownOptions, isRequired } = columnDefinition;

  // Check if required field is missing
  if (isRequired && (value === null || value === undefined || value === '')) {
    return {
      isValid: false,
      error: `${columnName} is required`
    };
  }

  // Allow null/undefined for optional fields
  if (value === null || value === undefined) {
    return { isValid: true, processedValue: null };
  }

  let processedValue = value;

  // Validate based on column type
  switch (columnType) {
    case PROJECT_COLUMN_TYPES.TEXT:
    case PROJECT_COLUMN_TYPES.LABEL:
      if (typeof value !== 'string') {
        return {
          isValid: false,
          error: `${columnName} must be a string`
        };
      }
      processedValue = value.trim();
      break;

    case PROJECT_COLUMN_TYPES.NUMBER:
    case PROJECT_COLUMN_TYPES.RATING:
      // Auto-convert string numbers to actual numbers
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (isNaN(parsed)) {
          return {
            isValid: false,
            error: `${columnName} must be a valid number`
          };
        }
        processedValue = parsed;
      } else if (typeof value === 'number' && !isNaN(value)) {
        processedValue = value;
      } else {
        return {
          isValid: false,
          error: `${columnName} must be a number`
        };
      }

      // Rating specific validation (now using processedValue)
      if (columnType === PROJECT_COLUMN_TYPES.RATING) {
        if (processedValue < 1 || processedValue > 5 || !Number.isInteger(processedValue)) {
          return {
            isValid: false,
            error: `${columnName} must be an integer between 1 and 5`
          };
        }
      }
      break;

    case PROJECT_COLUMN_TYPES.DATE:
      if (!isValidDate(value)) {
        return {
          isValid: false,
          error: `${columnName} must be a valid date`
        };
      }
      processedValue = new Date(value);
      break;

    case PROJECT_COLUMN_TYPES.CHECKBOX:
      // Auto-convert string booleans to actual booleans
      if (typeof value === 'string') {
        const lowerValue = value.toLowerCase();
        if (lowerValue === 'true') {
          processedValue = true;
        } else if (lowerValue === 'false') {
          processedValue = false;
        } else {
          return {
            isValid: false,
            error: `${columnName} must be a boolean or "true"/"false" string`
          };
        }
      } else if (typeof value === 'boolean') {
        processedValue = value;
      } else {
        return {
          isValid: false,
          error: `${columnName} must be a boolean`
        };
      }
      break;

    case PROJECT_COLUMN_TYPES.DROPDOWN:
      if (typeof value !== 'string') {
        return {
          isValid: false,
          error: `${columnName} must be a string`
        };
      }
      if (!dropdownOptions || !dropdownOptions.includes(value)) {
        return {
          isValid: false,
          error: `${columnName} must be one of: ${dropdownOptions?.join(', ')}`
        };
      }
      break;

    case PROJECT_COLUMN_TYPES.EMAIL:
      if (typeof value !== 'string' || !isValidEmail(value)) {
        return {
          isValid: false,
          error: `${columnName} must be a valid email address`
        };
      }
      processedValue = value.toLowerCase().trim();
      break;

    case PROJECT_COLUMN_TYPES.PHONE:
      if (typeof value !== 'string' || !isValidPhone(value)) {
        return {
          isValid: false,
          error: `${columnName} must be a valid phone number`
        };
      }
      processedValue = value.trim();
      break;

    case PROJECT_COLUMN_TYPES.LOCATION:
      if (!isValidLocation(value)) {
        return {
          isValid: false,
          error: `${columnName} must have address and optional coordinates`
        };
      }
      break;

    case PROJECT_COLUMN_TYPES.VOTING:
      if (!isValidVoting(value)) {
        return {
          isValid: false,
          error: `${columnName} must have votes array and count`
        };
      }
      break;

    case PROJECT_COLUMN_TYPES.SIGNATURE:
      if (!isValidSignature(value)) {
        return {
          isValid: false,
          error: `${columnName} must have signatureData, signedBy, signedAt, and signerName`
        };
      }
      break;

    default:
      return {
        isValid: false,
        error: `Unknown column type: ${columnType}`
      };
  }

  return { isValid: true, processedValue };
};

/**
 * Get default value for a column type
 */
const getDefaultValue = (columnType) => {
  switch (columnType) {
    case PROJECT_COLUMN_TYPES.TEXT:
    case PROJECT_COLUMN_TYPES.LABEL:
    case PROJECT_COLUMN_TYPES.EMAIL:
    case PROJECT_COLUMN_TYPES.PHONE:
    case PROJECT_COLUMN_TYPES.DROPDOWN:
      return null;

    case PROJECT_COLUMN_TYPES.NUMBER:
    case PROJECT_COLUMN_TYPES.RATING:
      return null;

    case PROJECT_COLUMN_TYPES.DATE:
      return null;

    case PROJECT_COLUMN_TYPES.CHECKBOX:
      return false;

    case PROJECT_COLUMN_TYPES.LOCATION:
      return null;

    case PROJECT_COLUMN_TYPES.VOTING:
      return { votes: [], count: 0, userVoted: false };

    case PROJECT_COLUMN_TYPES.SIGNATURE:
      return null;

    default:
      return null;
  }
};

/**
 * Process and validate column values for a task
 * @param {string} tabId - Tab ID
 * @param {Object} providedColumnValues - Column values from request
 * @returns {Object} { isValid, errors, processedValues }
 */
exports.processTaskColumnValues = async (tabId, providedColumnValues = {}) => {
  try {
    // Get all columns for this tab
    const projectColumns = await findManyProjectStatusColumns({
      tabId,
      isActive: true
    });

    const processedValues = {};
    const errors = [];

    // Only process columns that are actually provided (partial update support)
    for (const columnKey in providedColumnValues) {
      const providedValue = providedColumnValues[columnKey];

      // Find the column definition
      const column = projectColumns.find(col => col.columnKey === columnKey);

      // Skip if column doesn't exist or isn't active
      if (!column) {
        errors.push(`Unknown or inactive column: ${columnKey}`);
        continue;
      }

      // Validate the provided value
      const validation = validateColumnValue(providedValue, column);

      if (!validation.isValid) {
        errors.push(validation.error);
        continue;
      }

      // Only add provided values (no defaults for unprovided columns)
      processedValues[columnKey] = validation.processedValue;
    }

    return {
      isValid: errors.length === 0,
      errors,
      processedValues
    };

  } catch (error) {
    console.error('Error processing task column values:', error);
    return {
      isValid: false,
      errors: ['Failed to process column values'],
      processedValues: {}
    };
  }
};

/**
 * Apply default values for all columns in a tab
 * @param {string} tabId - Tab ID
 * @returns {Object} Default column values
 */
exports.getDefaultColumnValues = async (tabId) => {
  try {
    const projectColumns = await findManyProjectStatusColumns({
      tabId,
      isActive: true
    });

    const defaultValues = {};

    for (const column of projectColumns) {
      defaultValues[column.columnKey] = getDefaultValue(column.columnType);
    }

    return defaultValues;

  } catch (error) {
    console.error('Error getting default column values:', error);
    return {};
  }
};

module.exports = {
  processTaskColumnValues: exports.processTaskColumnValues,
  getDefaultColumnValues: exports.getDefaultColumnValues,
  validateColumnValue,
  getDefaultValue
};