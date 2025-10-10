"use strict";

/**
 * File type to MIME type mapping
 * Maps user-friendly type names to MIME type patterns
 */
const FILE_TYPE_MAPPINGS = {
  "photos&images": [
    /^image\/.*/,
  ],
  "videos": [
    /^video\/.*/,
  ],
  "archived(zip)": [
    "application/zip",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
  ],
  "pdf": [
    "application/pdf",
  ],
  "audio": [
    /^audio\/.*/,
  ],
  "document": [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "application/rtf",
  ],
};

/**
 * Get MIME type filter for aggregation query
 * @param {string} type - File type (all, photos&images, videos, etc.)
 * @returns {Object|null} MongoDB match condition or null for 'all'
 */
exports.getMimeTypeFilter = (type) => {
  // No filter for 'all'
  if (type === "all") {
    return null;
  }

  const mimeTypes = FILE_TYPE_MAPPINGS[type];
  if (!mimeTypes) {
    return null;
  }

  // Build $or condition for MIME type matching
  const conditions = mimeTypes.map((mimeType) => {
    if (mimeType instanceof RegExp) {
      // Convert regex to MongoDB $regex
      return {
        "files.mimeType": {
          $regex: mimeType.source,
          $options: "i",
        },
      };
    } else {
      // Exact match
      return { "files.mimeType": mimeType };
    }
  });

  return conditions.length > 0 ? { $or: conditions } : null;
};

/**
 * Get list of allowed file types
 * @returns {Array<string>} List of allowed type values
 */
exports.getAllowedFileTypes = () => {
  return ["all", ...Object.keys(FILE_TYPE_MAPPINGS)];
};
