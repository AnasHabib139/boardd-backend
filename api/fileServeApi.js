"use strict";

const { Router } = require("express");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const getS3Client = () =>
  new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_KEY,
    },
    ...(process.env.AWS_ENDPOINT && process.env.AWS_ENDPOINT !== "AWS_ENDPOINT"
      ? { endpoint: process.env.AWS_ENDPOINT }
      : {}),
  });

const streamFileFromS3 = async (s3Key, res) => {
  const s3client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: s3Key,
  });

  const response = await s3client.send(command);

  // Forward content headers so browsers handle the file correctly
  if (response.ContentType) res.set("Content-Type", response.ContentType);
  if (response.ContentLength) res.set("Content-Length", response.ContentLength);
  if (response.ContentDisposition) res.set("Content-Disposition", response.ContentDisposition);

  // Allow any origin — file URLs are non-sensitive, public S3 objects
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");

  // Stream S3 body directly to client
  response.Body.pipe(res);
};

class FileServeApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Proxy files from S3 instead of redirecting, so CORS headers are always present.
    // Handles: /uploadFiles/images/file.jpg, /uploadFiles/videos/file.mp4, etc.
    router.get("/:folder/:filename", async (req, res) => {
      try {
        const { folder, filename } = req.params;
        const s3Key = `uploadFiles/${folder}/${filename}`;
        await streamFileFromS3(s3Key, res);
      } catch (error) {
        if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
          return res.status(404).json({ success: false, message: "File not found" });
        }
        console.error("Error serving file:", error);
        res.status(500).json({ success: false, message: "Error serving file" });
      }
    });

    // Handle nested paths (subfolders inside uploadFiles)
    router.get("/:folder/:subfolder/:filename", async (req, res) => {
      try {
        const { folder, subfolder, filename } = req.params;
        const s3Key = `uploadFiles/${folder}/${subfolder}/${filename}`;
        await streamFileFromS3(s3Key, res);
      } catch (error) {
        if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
          return res.status(404).json({ success: false, message: "File not found" });
        }
        console.error("Error serving file:", error);
        res.status(500).json({ success: false, message: "Error serving file" });
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
