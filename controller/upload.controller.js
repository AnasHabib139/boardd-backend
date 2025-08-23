const { generateResponse } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { s3Uploadv3, deleteFiles: deleteS3Files } = require("../utils/s3Upload");

/**
 * Upload multiple files to S3
 * @route POST /api/upload/files
 */
exports.uploadMultipleFiles = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "No file uploaded",
      });
    }

    // Upload files to S3
    const uploadResults = await s3Uploadv3(req.files);

    // Extract file paths for backward compatibility
    const filePaths = uploadResults.map(result => result.path);

    // Return the file paths and additional info
    return generateResponse(
      { 
        filePaths,
        files: uploadResults.map(result => ({
          path: result.path,
          filename: result.filename,
          mimetype: result.mimetype,
          size: result.size
        }))
      },
      "Files uploaded successfully to S3",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in uploadMultipleFiles:", error);
    next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "File upload failed",
    });
  }
};

/**
 * Delete files from S3 (can handle both single file path or array of file paths)
 * @route DELETE /api/upload/files
 */
exports.deleteFiles = async (req, res, next) => {
  try {
    const { files } = req.body;

    // Validate files parameter
    if (!files) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "No files specified for deletion",
      });
    }

    // Convert to array if single file path is provided
    const filePaths = Array.isArray(files) ? files : [files];

    // Validate that all paths are within uploadFiles for security
    for (const filePath of filePaths) {
      const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
      if (!cleanPath.startsWith("uploadFiles/")) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Invalid file path: ${filePath}. Only uploadFiles/* paths are allowed.`,
        });
      }
    }

    // Delete files from S3
    const results = await deleteS3Files(filePaths);

    // Generate appropriate response based on results
    if (results.failed.length === 0) {
      return generateResponse(
        results,
        "All files deleted successfully from S3",
        res,
        STATUS_CODES.SUCCESS
      );
    } else if (results.successful.length === 0) {
      return generateResponse(
        results,
        "Failed to delete all files from S3",
        res,
        STATUS_CODES.BAD_REQUEST
      );
    } else {
      return generateResponse(
        results,
        "Some files were deleted successfully from S3",
        res,
        STATUS_CODES.SUCCESS
      );
    }
  } catch (error) {
    console.error("Error in deleteFiles:", error);
    next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "File deletion failed",
    });
  }
};
