"use strict";

const multer = require("multer");
const fs = require("fs");
const FCM = require("fcm-node");
const { STATUS_CODES } = require("./constants");
const { COOKIE_CONFIG } = require("./tokenConstants");
const moment = require("moment");
const path = require("path");

exports.generateResponse = (data, message, res, code = 200) => {
  return res.status(code).json({
    message,
    data,
  });
};

exports.parseBody = (body) => {
  let obj;
  if (typeof body === "object") obj = body;
  else obj = JSON.parse(body);
  return obj;
};

exports.generateRandomOTP = () => {
  return Math.floor(100000 + Math.random() * 900000);
};

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Choose destination based on file type
    const isImage = file.mimetype.startsWith("image/");
    const uploadPath = isImage
      ? "./uploadFiles/images"
      : "./uploadFiles/documents";

    // Create directories if they don't exist
    fs.mkdirSync("./uploadFiles", { recursive: true });
    fs.mkdirSync("./uploadFiles/images", { recursive: true });
    fs.mkdirSync("./uploadFiles/documents", { recursive: true });

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and original extension
    const fileName = `${file.fieldname}-${Date.now()}${path.extname(
      file.originalname
    )}`;
    const isImage = file.mimetype.startsWith("image/");
    const filePath = isImage
      ? `/uploadFiles/images/${fileName}`
      : `/uploadFiles/documents/${fileName}`;
    req.filepath = filePath;
    cb(null, fileName);
  },
});

// File type validation
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedDocTypes = /pdf|docx?|xlsx?|pptx?/;
  const allowedImageTypes = /jpeg|jpg|png|gif/;

  const ext = path.extname(file.originalname).toLowerCase();
  const isImage = file.mimetype.startsWith("image/");

  if (isImage) {
    // Check image types
    if (allowedImageTypes.test(ext.substring(1))) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, JPG, PNG and GIF images are allowed!"));
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
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Export the upload middleware
exports.uploadFiles = upload;

exports.sendNotificationToAll = ({ body, fcmTokens }) => {
  const serverKey = process.env.FIREBASE_SERVER_KEY;
  const fcm = new FCM(serverKey);
  const title = process.env.APP_NAME;

  const message = {
    // the registration tokens of the devices you want to send the message to
    registration_ids: [...fcmTokens],
    notification: { title, body },
  };

  fcm.send(message, function (err, response) {
    if (err) {
      console.log("FCM - Something has gone wrong!");
    } else {
      console.log("Successfully sent with response: ", response);
    }
  });
};

// pagination with mongoose paginate library
exports.getMongoosePaginatedData = async ({
  model,
  page = 1,
  limit = 10,
  query = {},
  populate = "",
  select = "-password",
  sort = { createdAt: -1 },
}) => {
  const options = {
    select,
    sort,
    populate,
    lean: true,
    page,
    limit,
    customLabels: {
      totalDocs: "totalItems",
      docs: "data",
      limit: "perPage",
      page: "currentPage",
      meta: "pagination",
    },
  };

  const { data, pagination } = await model.paginate(query, options);
  return { data, pagination };
};

// aggregate pagination with mongoose paginate library
exports.getMongooseAggregatePaginatedData = async ({
  model,
  page = 1,
  limit = 10,
  query = [],
  populate = "",
  select = "-password",
  sort = { createdAt: -1 },
}) => {
  const options = {
    select,
    sort,
    populate,
    lean: true,
    page,
    limit,
    customLabels: {
      totalDocs: "totalItems",
      docs: "data",
      limit: "perPage",
      page: "currentPage",
      meta: "pagination",
    },
  };

  const myAggregate = model.aggregate(query);
  const { data, pagination } = await model.aggregatePaginate(
    myAggregate,
    options
  );
  return { data, pagination };
};

exports.sendNotification = ({
  title,
  body,
  fcmToken,
  data,
  priority = "normal",
}) => {
  const serverKey = process.env.FIREBASE_SERVER_KEY;
  const fcm = new FCM(serverKey);

  const message = {
    to: fcmToken,
    priority,
    notification: {
      title,
      body,
    },
    data,
  };

  // Send the notification
  fcm.send(message, (error, response) => {
    if (error) {
      console.error("Error sending notification:", error);
    } else {
      console.log("Notification sent successfully:", response);
    }
  });
};

exports.formatDate = (date) => moment(date).format("DD-MM-YYYY");

exports.formatTime = (date) => moment(date).format("HH:mm:ss");

exports.formatDateTime = (date) => moment(date).format("DD-MM-YYYY HH:mm:ss");

// Helper function to generate activity messages
exports.generateActivityMessage = (field, userName, data) => {
  const { previousValue, newValue, taskTitle, isCreation = false } = data;

  switch (field) {
    case "status":
      if (isCreation || previousValue === null || previousValue === undefined) {
        return {
          forCreator: `You changed the status to ${newValue}`,
          forOthers: `${userName} changed the status to ${newValue}`,
        };
      }
      return {
        forCreator: `You changed the status of "${taskTitle}" from ${previousValue} to ${newValue}`,
        forOthers: `${userName} changed the status of "${taskTitle}" from ${previousValue} to ${newValue}`,
      };

    case "priority":
      if (isCreation || previousValue === null || previousValue === undefined) {
        return {
          forCreator: `You changed the priority of "${taskTitle}" to ${newValue}`,
          forOthers: `${userName} changed the priority of "${taskTitle}" to ${newValue}`,
        };
      }
      return {
        forCreator: `You changed the priority of "${taskTitle}" from ${previousValue} to ${newValue}`,
        forOthers: `${userName} changed the priority of "${taskTitle}" from ${previousValue} to ${newValue}`,
      };

    case "dueDate":
      if (isCreation || previousValue === null || previousValue === undefined) {
        return {
          forCreator: `You set the due date of "${taskTitle}" to ${new Date(
            newValue
          ).toLocaleDateString()}`,
          forOthers: `${userName} set the due date of "${taskTitle}" to ${new Date(
            newValue
          ).toLocaleDateString()}`,
        };
      }
      return {
        forCreator: `You changed the due date of "${taskTitle}" to ${new Date(
          newValue
        ).toLocaleDateString()}`,
        forOthers: `${userName} changed the due date of "${taskTitle}" to ${new Date(
          newValue
        ).toLocaleDateString()}`,
      };

    case "assignedTo":
      return {
        forCreator: `You assigned "${taskTitle}" to ${
          Array.isArray(newValue) ? newValue.join(", ") : newValue
        }`,
        forOthers: `${userName} assigned "${taskTitle}" to ${
          Array.isArray(newValue) ? newValue.join(", ") : newValue
        }`,
      };

    case "description":
      if (isCreation || previousValue === null || previousValue === undefined) {
        return {
          forCreator: `You added description to "${taskTitle}"`,
          forOthers: `${userName} added description to "${taskTitle}"`,
        };
      }
      return {
        forCreator: `You updated the description of "${taskTitle}"`,
        forOthers: `${userName} updated the description of "${taskTitle}"`,
      };

    case "strokeColor":
      return {
        forCreator: `You changed the color of "${taskTitle}"`,
        forOthers: `${userName} changed the color of "${taskTitle}"`,
      };

    case "tags":
      const addedTags = newValue.filter((tag) => !previousValue.includes(tag));
      const removedTags = previousValue.filter(
        (tag) => !newValue.includes(tag)
      );
      if (addedTags.length > 0) {
        return {
          forCreator: `You added tags ${addedTags.join(
            ", "
          )} to "${taskTitle}"`,
          forOthers: `${userName} added tags ${addedTags.join(
            ", "
          )} to "${taskTitle}"`,
        };
      } else {
        return {
          forCreator: `You removed tags ${removedTags.join(
            ", "
          )} from "${taskTitle}"`,
          forOthers: `${userName} removed tags ${removedTags.join(
            ", "
          )} from "${taskTitle}"`,
        };
      }

    default:
      if (isCreation || previousValue === null || previousValue === undefined) {
        return {
          forCreator: `You set ${field} of "${taskTitle}" to ${newValue}`,
          forOthers: `${userName} set ${field} of "${taskTitle}" to ${newValue}`,
        };
      }
      return {
        forCreator: `You updated ${field} of "${taskTitle}"`,
        forOthers: `${userName} updated ${field} of "${taskTitle}"`,
      };
  }
};

// Helper function to set refresh token cookie
exports.setRefreshTokenCookie = (res, refreshToken) => {
  const cookieOptions = {
    httpOnly: COOKIE_CONFIG.HTTP_ONLY,
    secure: COOKIE_CONFIG.SECURE,
    sameSite: COOKIE_CONFIG.SAME_SITE,
    maxAge: COOKIE_CONFIG.MAX_AGE,
  };

  // Add domain if specified (for cross-domain support)
  if (COOKIE_CONFIG.DOMAIN) {
    cookieOptions.domain = COOKIE_CONFIG.DOMAIN;
  }

  res.cookie(COOKIE_CONFIG.REFRESH_TOKEN_NAME, refreshToken, cookieOptions);
};

// Helper function to extract domain from email
exports.extractDomainFromEmail = (email) => {
  return email.split("@")[1];
};

// Helper function to generate next order number for form fields
exports.generateNextOrder = (fields) => {
  if (!fields || fields.length === 0) return 1;
  const maxOrder = Math.max(...fields.map((field) => field.order || 0));
  return maxOrder + 1;
};

// Helper function to delete file from disk
exports.deleteFileFromDisk = (filePath) => {
  try {
    // Remove the leading slash if present and construct absolute path
    const relativePath = filePath.startsWith("/")
      ? filePath.slice(1)
      : filePath;
    const absolutePath = path.join(process.cwd(), relativePath);

    // Verify the path is within uploadFiles directory for security
    const uploadFilesDir = path.join(process.cwd(), "uploadFiles");
    if (!absolutePath.startsWith(uploadFilesDir)) {
      console.error(
        `Security violation: Attempted to delete file outside uploadFiles directory: ${filePath}`
      );
      return {
        success: false,
        error: "Invalid file path - Security violation",
      };
    }

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      console.warn(`File not found for deletion: ${filePath}`);
      return { success: false, error: "File not found" };
    }

    // Delete the file
    fs.unlinkSync(absolutePath);
    console.log(`Successfully deleted file: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting file ${filePath}:`, error.message);
    return { success: false, error: error.message };
  }
};
