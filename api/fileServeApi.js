"use strict";

const { Router } = require("express");

class FileServeApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Serve files from S3 (proxy route)
    // This handles: /uploadFiles/images/file.jpg, /uploadFiles/videos/file.mp4, etc.
    router.get("/:folder/:filename", async (req, res, next) => {
      try {
        const { folder, filename } = req.params;

        // URL encode the filename to handle spaces and special characters
        const encodedFilename = encodeURIComponent(filename);

        // Construct S3 URL (router is mounted at /uploadFiles, so params are folder/filename)
        const s3Url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploadFiles/${folder}/${encodedFilename}`;

        // Redirect to S3 URL
        res.redirect(301, s3Url);
      } catch (error) {
        console.error("Error serving file:", error);
        res.status(404).json({
          success: false,
          message: "File not found",
        });
      }
    });

    // Handle nested paths (for files with dots in name or additional subfolders)
    router.get("/:folder/:subfolder/:filename", async (req, res, next) => {
      try {
        const { folder, subfolder, filename } = req.params;

        // URL encode the filename to handle spaces and special characters
        const encodedFilename = encodeURIComponent(filename);

        // Construct S3 URL (router is mounted at /uploadFiles, so params are folder/subfolder/filename)
        const s3Url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploadFiles/${folder}/${subfolder}/${encodedFilename}`;

        // Redirect to S3 URL
        res.redirect(301, s3Url);
      } catch (error) {
        console.error("Error serving file:", error);
        res.status(404).json({
          success: false,
          message: "File not found",
        });
      }
    });
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/uploadFiles";
  }
}

module.exports = FileServeApi;
