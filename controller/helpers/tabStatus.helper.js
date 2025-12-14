"use strict";

const {
  findManyTabTaskStatuses,
  initializeSystemStatuses,
  hasStatusesInitialized,
  getProjectStatusKeys,
  SYSTEM_STATUSES,
} = require("../../models/tabTaskStatusModel");

/**
 * Get valid status keys for a project
 * Used for status validation in task updates
 */
exports.getValidStatusKeys = async (projectId) => {
  return await getProjectStatusKeys(projectId);
};

/**
 * Validate if a status key is valid for a project
 */
exports.isValidStatusKey = async (projectId, statusKey) => {
  const validKeys = await getProjectStatusKeys(projectId);
  return validKeys.includes(statusKey);
};

/**
 * Initialize system statuses for a project if not already done
 * Called when creating a new project
 */
exports.ensureProjectStatusesInitialized = async (projectId) => {
  const hasStatuses = await hasStatusesInitialized(projectId);
  if (!hasStatuses) {
    await initializeSystemStatuses(projectId);
    return true;
  }
  return false;
};

/**
 * Get all statuses for a project with their metadata
 * Returns ordered list of statuses
 */
exports.getProjectStatuses = async (projectId) => {
  return await findManyTabTaskStatuses({ projectId, isActive: true });
};

/**
 * Get status metadata by key
 */
exports.getStatusByKey = async (projectId, statusKey) => {
  const statuses = await findManyTabTaskStatuses({ projectId, statusKey, isActive: true });
  return statuses.length > 0 ? statuses[0] : null;
};

/**
 * Check if a status is a system status
 */
exports.isSystemStatus = (statusKey) => {
  return SYSTEM_STATUSES.some((s) => s.statusKey === statusKey);
};

/**
 * Get default system statuses (for reference)
 */
exports.getSystemStatuses = () => SYSTEM_STATUSES;

module.exports = exports;
