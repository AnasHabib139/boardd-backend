const multer = require("multer");
const {
  S3Client,
  PutObjectCommand,
  S3,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const uuid = require("uuid").v4;
const storage = multer.memoryStorage();

function config() {
  const config = {
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_KEY,
    },
  };

  // Only add endpoint if it's provided and valid (for custom S3-compatible services)
  if (process.env.AWS_ENDPOINT && process.env.AWS_ENDPOINT !== "AWS_ENDPOINT") {
    config.endpoint = process.env.AWS_ENDPOINT;
  }

  return config;
}

const fileFilter = (req, file, cb) => {
  try {
    // Allowed file types
    const allowedDocTypes = /pdf|docx?|xlsx?|pptx?/;
    const allowedImageTypes = /jpeg|jpg|png|gif/;
    const allowedVideoTypes = /mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp/;

    const ext = require("path").extname(file.originalname).toLowerCase();
    const fileType = file.mimetype.split("/")[0];

    if (fileType === "image") {
      // Check image types
      if (allowedImageTypes.test(ext.substring(1))) {
        cb(null, true);
      } else {
        cb(new Error("Only JPEG, JPG, PNG and GIF images are allowed!"));
      }
    } else if (fileType === "video") {
      // Check video types
      if (allowedVideoTypes.test(ext.substring(1))) {
        cb(null, true);
      } else {
        cb(
          new Error(
            "Only MP4, MOV, AVI, MKV, WMV, FLV, WEBM, M4V, and 3GP videos are allowed!"
          )
        );
      }
    } else {
      // Check document types
      const isValidExt = allowedDocTypes.test(ext.substring(1));
      const isValidMime =
        /application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-powerpoint|application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/.test(
          file.mimetype
        );

      if (isValidExt && isValidMime) {
        cb(null, true);
      } else {
        cb(new Error("Only PDF, PPT, Excel, and Word documents are allowed!"));
      }
    }
  } catch (e) {
    console.log(e);
    cb(new Error("File validation error"));
  }
};

// ["image", "jpeg"]

exports.upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024, files: 4 }, // 100MB limit for videos
});

exports.s3Uploadv3 = async (files, base64 = false) => {
  try {
    const s3client = new S3Client(config());
    let uploadResults = [];
    let buf;

    for (const file of files) {
      // Determine file category for path structure
      const isImage = file.mimetype.startsWith("image/");
      const isVideo = file.mimetype.startsWith("video/");
      let category;

      if (isImage) {
        category = "images";
      } else if (isVideo) {
        category = "videos";
      } else {
        category = "documents";
      }

      // Generate filename with timestamp and sanitize original name
      const timestamp = Date.now();
      const originalName = base64 ? "image.png" : file.originalname;

      // Sanitize filename: replace spaces and special chars with underscores, keep extension
      const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileName = `files-${timestamp}-${sanitizedName}`;

      // Create S3 key maintaining uploadFiles structure for backward compatibility
      const s3Key = `uploadFiles/${category}/${fileName}`;

      if (base64) {
        buf = Buffer.from(
          file.replace(/^data:image\/\w+;base64,/, ""),
          "base64"
        );
      }

      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: base64 ? buf : file.buffer,
        ContentType:
          file.mimetype || (base64 ? "image/png" : "application/octet-stream"),
      };

      try {
        const result = await s3client.send(new PutObjectCommand(uploadParams));
        uploadResults.push({
          key: s3Key,
          path: `/${s3Key}`, // Return with leading slash for backward compatibility
          filename: fileName,
          mimetype: file.mimetype,
          size: file.size,
        });
        console.log(`File uploaded successfully: ${s3Key}`);
      } catch (uploadError) {
        console.error(`Failed to upload file ${fileName}:`, uploadError);
        throw uploadError;
      }
    }

    return uploadResults;
  } catch (e) {
    console.error("S3 upload error:", e);
    throw e;
  }
};

exports.deleteFiles = async (filePaths) => {
  try {
    if (!filePaths || filePaths.length === 0) return [];
    const s3client = new S3Client(config());

    const results = {
      successful: [],
      failed: [],
    };

    for (const filePath of filePaths) {
      try {
        // Convert file path to S3 key (remove leading slash if present)
        const s3Key = filePath.startsWith("/") ? filePath.slice(1) : filePath;

        const deleteParams = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: s3Key,
        };

        await s3client.send(new DeleteObjectCommand(deleteParams));
        results.successful.push(filePath);
        console.log(`File deleted successfully: ${s3Key}`);
      } catch (deleteError) {
        console.error(`Failed to delete file ${filePath}:`, deleteError);
        results.failed.push({
          path: filePath,
          error: deleteError.message,
        });
      }
    }

    return results;
  } catch (e) {
    console.error("S3 delete error:", e);
    throw e;
  }
};

// Keep old function name for backward compatibility
exports.deleteImage = exports.deleteFiles;
