const {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const migration = {
  name: "003-reorganize-s3-structure",
  version: "1.0.0",
  description:
    "Move documents/ and images/ folders into uploadFiles/ and merge with existing structure",

  // S3 Client configuration
  getS3Client: () => {
    const config = {
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
      },
    };

    // Only add endpoint if it's provided and valid (for custom S3-compatible services)
    if (
      process.env.AWS_ENDPOINT &&
      process.env.AWS_ENDPOINT !== "AWS_ENDPOINT"
    ) {
      config.endpoint = process.env.AWS_ENDPOINT;
    }

    return new S3Client(config);
  },

  // List all objects with a given prefix
  listObjects: async (s3Client, prefix) => {
    const objects = [];
    let continuationToken = null;

    do {
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: 1000,
      };

      if (continuationToken) {
        params.ContinuationToken = continuationToken;
      }

      try {
        const response = await s3Client.send(new ListObjectsV2Command(params));

        if (response.Contents) {
          objects.push(...response.Contents);
        }

        continuationToken = response.NextContinuationToken;
      } catch (error) {
        console.error(`Error listing objects with prefix ${prefix}:`, error);
        throw error;
      }
    } while (continuationToken);

    return objects;
  },

  // Copy object from source to destination
  copyObject: async (s3Client, sourceKey, destinationKey) => {
    try {
      const copyParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        CopySource: `${process.env.AWS_BUCKET_NAME}/${sourceKey}`,
        Key: destinationKey,
      };

      await s3Client.send(new CopyObjectCommand(copyParams));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Delete object
  deleteObject: async (s3Client, key) => {
    try {
      const deleteParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
      };

      await s3Client.send(new DeleteObjectCommand(deleteParams));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Migration UP - Reorganize S3 structure
  up: async () => {
    console.log("🚀 Running migration: Reorganize S3 folder structure...");

    // Check required environment variables
    const requiredEnvVars = [
      "AWS_ACCESS_KEY",
      "AWS_SECRET_KEY",
      "AWS_REGION",
      "AWS_BUCKET_NAME",
    ];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    const s3Client = migration.getS3Client();

    const stats = {
      totalProcessed: 0,
      copied: 0,
      deleted: 0,
      failed: 0,
      errors: [],
    };

    // Folders to move into uploadFiles/
    const foldersToMove = ["documents/", "images/"];

    for (const folder of foldersToMove) {
      console.log(`\n📁 Processing folder: ${folder}`);

      try {
        // List all objects in this folder
        const objects = await migration.listObjects(s3Client, folder);

        if (objects.length === 0) {
          console.log(`ℹ️ No objects found in ${folder}`);
          continue;
        }

        console.log(`📋 Found ${objects.length} objects in ${folder}`);

        for (const object of objects) {
          stats.totalProcessed++;

          // Skip if it's just a folder marker (ends with /)
          if (object.Key.endsWith("/")) {
            console.log(`⏭️ Skipping folder marker: ${object.Key}`);
            continue;
          }

          // Create new key under uploadFiles/
          const newKey = `uploadFiles/${object.Key}`;

          console.log(`📤 Moving: ${object.Key} → ${newKey}`);

          // Check if destination already exists
          try {
            const existingObjects = await migration.listObjects(
              s3Client,
              newKey
            );
            if (existingObjects.some((obj) => obj.Key === newKey)) {
              console.log(
                `⚠️ File already exists at destination: ${newKey}, skipping...`
              );
              continue;
            }
          } catch (error) {
            // If we can't check, proceed with copy
            console.log(
              `ℹ️ Could not check if ${newKey} exists, proceeding with copy`
            );
          }

          // Copy object to new location
          const copyResult = await migration.copyObject(
            s3Client,
            object.Key,
            newKey
          );

          if (copyResult.success) {
            stats.copied++;
            console.log(`✅ Copied: ${object.Key} → ${newKey}`);

            // Delete original object
            const deleteResult = await migration.deleteObject(
              s3Client,
              object.Key
            );

            if (deleteResult.success) {
              stats.deleted++;
              console.log(`🗑️ Deleted original: ${object.Key}`);
            } else {
              console.warn(
                `⚠️ Failed to delete original ${object.Key}: ${deleteResult.error}`
              );
              // Don't count as failure since copy succeeded
            }
          } else {
            stats.failed++;
            const errorMsg = `Failed to copy ${object.Key}: ${copyResult.error}`;
            console.error(`❌ ${errorMsg}`);
            stats.errors.push(errorMsg);
          }
        }
      } catch (error) {
        stats.failed++;
        const errorMsg = `Error processing folder ${folder}: ${error.message}`;
        console.error(`❌ ${errorMsg}`);
        stats.errors.push(errorMsg);
      }
    }

    // Summary
    console.log("\n📊 Migration Summary:");
    console.log(`   Total objects processed: ${stats.totalProcessed}`);
    console.log(`   ✅ Successfully copied: ${stats.copied}`);
    console.log(`   🗑️ Originals deleted: ${stats.deleted}`);
    console.log(`   ❌ Failed: ${stats.failed}`);

    if (stats.failed > 0) {
      console.log("\n❌ Errors encountered:");
      stats.errors.forEach((error) => console.log(`   - ${error}`));
    }

    // Verify final structure
    console.log("\n🔍 Verifying final structure...");
    try {
      const uploadFilesObjects = await migration.listObjects(
        s3Client,
        "uploadFiles/"
      );
      console.log(
        `📁 uploadFiles/ now contains ${uploadFilesObjects.length} objects`
      );

      // Show folder structure
      const folders = new Set();
      uploadFilesObjects.forEach((obj) => {
        const parts = obj.Key.split("/");
        if (parts.length > 2) {
          // uploadFiles/folder/file
          folders.add(parts[1]);
        }
      });

      console.log(
        `📂 Subfolders in uploadFiles/: ${Array.from(folders).join(", ")}`
      );
    } catch (error) {
      console.warn(`⚠️ Could not verify final structure: ${error.message}`);
    }

    const success = stats.copied > 0 || stats.totalProcessed === 0;
    const message = success
      ? `Successfully reorganized S3 structure. Moved ${stats.copied} files into uploadFiles/`
      : "No files were moved";

    return {
      success,
      message,
      stats,
    };
  },

  // Migration DOWN - This is a one-way migration, rollback not supported
  down: async () => {
    console.log("⚠️ This migration cannot be rolled back automatically.");
    console.log("💡 Files have been moved within S3 bucket.");
    console.log("🔄 To restore original structure, you would need to:");
    console.log(
      "   1. Move files back from uploadFiles/ to root level manually"
    );
    console.log("   2. Use AWS CLI or S3 console");

    return {
      success: false,
      message:
        "Rollback not supported for S3 reorganization. Files are now under uploadFiles/.",
    };
  },
};

module.exports = migration;
