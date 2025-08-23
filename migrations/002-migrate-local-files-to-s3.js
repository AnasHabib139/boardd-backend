const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const migration = {
  name: "002-migrate-local-files-to-s3",
  version: "1.0.0",
  description: "One-time migration: Upload all local uploadFiles to S3 and delete local files",

  // S3 Client configuration
  getS3Client: () => {
    return new S3Client({
      region: process.env.AWS_REGION,
      endpoint: process.env.AWS_ENDPOINT,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
      },
    });
  },

  // Get all files from uploadFiles directory recursively
  getAllLocalFiles: (dir) => {
    const files = [];
    
    const scanDirectory = (currentDir) => {
      if (!fs.existsSync(currentDir)) {
        return;
      }

      const items = fs.readdirSync(currentDir);
      
      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          scanDirectory(fullPath);
        } else if (stat.isFile()) {
          files.push({
            fullPath: fullPath,
            relativePath: path.relative(dir, fullPath),
            size: stat.size,
            name: item,
          });
        }
      }
    };

    scanDirectory(dir);
    return files;
  },

  // Upload single file to S3
  uploadFileToS3: async (s3Client, localFilePath, s3Key, contentType) => {
    try {
      const fileBuffer = fs.readFileSync(localFilePath);
      
      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType || "application/octet-stream",
      };

      const result = await s3Client.send(new PutObjectCommand(uploadParams));
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Get content type based on file extension
  getContentType: (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      // Images
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg", 
      ".png": "image/png",
      ".gif": "image/gif",
      
      // Videos
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".mkv": "video/x-matroska",
      ".wmv": "video/x-ms-wmv",
      ".flv": "video/x-flv",
      ".webm": "video/webm",
      ".m4v": "video/x-m4v",
      ".3gp": "video/3gpp",
      
      // Documents
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    
    return mimeTypes[ext] || "application/octet-stream";
  },

  // Migration UP - Upload all local files to S3 and delete them
  up: async () => {
    console.log("🚀 Running migration: Upload local files to S3...");

    // Check required environment variables
    const requiredEnvVars = ["AWS_ACCESS_KEY", "AWS_SECRET_KEY", "AWS_REGION", "AWS_BUCKET_NAME"];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    const uploadFilesDir = path.join(process.cwd(), "uploadFiles");
    
    // Check if uploadFiles directory exists
    if (!fs.existsSync(uploadFilesDir)) {
      console.log("ℹ️ No uploadFiles directory found, nothing to migrate");
      return {
        success: true,
        message: "No uploadFiles directory found",
        stats: { total: 0, uploaded: 0, deleted: 0, failed: 0 }
      };
    }

    // Get all files
    const files = migration.getAllLocalFiles(uploadFilesDir);
    
    if (files.length === 0) {
      console.log("ℹ️ No files found in uploadFiles directory");
      return {
        success: true,
        message: "No files to migrate",
        stats: { total: 0, uploaded: 0, deleted: 0, failed: 0 }
      };
    }

    console.log(`📁 Found ${files.length} files to migrate`);
    
    // Initialize S3 client
    const s3Client = migration.getS3Client();
    
    const stats = {
      total: files.length,
      uploaded: 0,
      deleted: 0,
      failed: 0,
      errors: []
    };

    // Process each file
    for (const file of files) {
      try {
        console.log(`📤 Uploading: ${file.relativePath} (${(file.size / 1024).toFixed(1)} KB)`);
        
        // Convert Windows path separators to forward slashes for S3 key
        const s3Key = file.relativePath.replace(/\\/g, '/');
        const contentType = migration.getContentType(file.fullPath);
        
        // Upload to S3
        const uploadResult = await migration.uploadFileToS3(
          s3Client,
          file.fullPath,
          s3Key,
          contentType
        );
        
        if (uploadResult.success) {
          stats.uploaded++;
          console.log(`✅ Uploaded: ${s3Key}`);
          
          // Delete local file after successful upload
          try {
            fs.unlinkSync(file.fullPath);
            stats.deleted++;
            console.log(`🗑️ Deleted local: ${file.relativePath}`);
          } catch (deleteError) {
            console.warn(`⚠️ Failed to delete local file: ${file.relativePath} - ${deleteError.message}`);
            // Don't count as failure since upload succeeded
          }
        } else {
          stats.failed++;
          const errorMsg = `Failed to upload ${file.relativePath}: ${uploadResult.error}`;
          console.error(`❌ ${errorMsg}`);
          stats.errors.push(errorMsg);
        }
      } catch (error) {
        stats.failed++;
        const errorMsg = `Error processing ${file.relativePath}: ${error.message}`;
        console.error(`❌ ${errorMsg}`);
        stats.errors.push(errorMsg);
      }
    }

    // Clean up empty directories
    try {
      const subDirs = ["images", "videos", "documents"];
      for (const subDir of subDirs) {
        const dirPath = path.join(uploadFilesDir, subDir);
        if (fs.existsSync(dirPath)) {
          const dirContents = fs.readdirSync(dirPath);
          if (dirContents.length === 0) {
            fs.rmdirSync(dirPath);
            console.log(`🗂️ Removed empty directory: ${subDir}`);
          }
        }
      }
      
      // Remove main uploadFiles directory if empty
      const mainDirContents = fs.readdirSync(uploadFilesDir);
      if (mainDirContents.length === 0) {
        fs.rmdirSync(uploadFilesDir);
        console.log("🗂️ Removed empty uploadFiles directory");
      }
    } catch (cleanupError) {
      console.warn(`⚠️ Directory cleanup warning: ${cleanupError.message}`);
    }

    // Summary
    console.log("\n📊 Migration Summary:");
    console.log(`   Total files: ${stats.total}`);
    console.log(`   ✅ Uploaded: ${stats.uploaded}`);
    console.log(`   🗑️ Deleted: ${stats.deleted}`);
    console.log(`   ❌ Failed: ${stats.failed}`);

    if (stats.failed > 0) {
      console.log("\n❌ Errors encountered:");
      stats.errors.forEach(error => console.log(`   - ${error}`));
      
      // Migration succeeds even with some failures, but logs them
      if (stats.uploaded === 0) {
        throw new Error("No files were uploaded successfully");
      }
    }

    const success = stats.uploaded > 0;
    const message = success 
      ? `Successfully migrated ${stats.uploaded}/${stats.total} files to S3`
      : "No files were migrated";

    return {
      success,
      message,
      stats
    };
  },

  // Migration DOWN - This is a one-way migration, rollback not supported
  down: async () => {
    console.log("⚠️ This migration cannot be rolled back automatically.");
    console.log("💡 Files have been uploaded to S3 and deleted locally.");
    console.log("🔄 To restore files, you would need to:");
    console.log("   1. Download files from S3 manually");
    console.log("   2. Recreate the local uploadFiles directory structure");
    
    return {
      success: false,
      message: "Rollback not supported for file migration. Files are now in S3.",
    };
  },
};

module.exports = migration;