"use strict";

const { Schema, model, Types } = require("mongoose");
const { sign } = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { ROLES } = require("../utils/constants");
const { createDeviceFingerprint } = require("../utils/deviceDetection");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

// User Settings Subschema
const userSettingsSchema = new Schema(
  {
    // Theme settings
    theme: {
      color: {
        type: String,
        default: "#6C63FF", // Default primary color
        validate: {
          validator: function(v) {
            return /^#([0-9A-F]{3}){1,2}$/i.test(v);
          },
          message: "Theme color must be a valid hex color code"
        }
      }
    },

    // Localization settings
    localization: {
      language: {
        type: String,
        default: "english",
        lowercase: true,
        trim: true
      },
      timezone: {
        type: String,
        default: "UTC",
        // Common timezone formats: UTC, America/New_York, Asia/Karachi, Europe/London
      },
      timeFormat: {
        type: String,
        enum: ["12", "24"],
        default: "12"
      },
      dateFormat: {
        type: String,
        enum: ["dd/mm/yyyy", "mm/dd/yyyy", "yyyy/mm/dd", "yyyy-mm-dd"],
        default: "dd/mm/yyyy"
      }
    },

    // Notification preferences (for future use)
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      },
      desktop: {
        type: Boolean,
        default: false
      }
    },

    // Privacy settings (for future use)
    privacy: {
      profileVisibility: {
        type: String,
        enum: ["public", "company", "private"],
        default: "company"
      }
    }
  },
  { _id: false } // Don't create separate _id for settings subdocument
);

// Token Subschema for refresh tokens
const refreshTokenSchema = new Schema(
  {
    token: {
      type: String,
      required: true,
    },
    deviceInfo: {
      userAgent: { type: String },
      ipAddress: { type: String },
      browser: { type: String },
      os: { type: String },
      deviceType: { type: String }, // mobile, desktop, tablet
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    revokedAt: {
      type: Date,
    },
  },
  { _id: true } // Allow MongoDB to generate _id for each token
);

const userSchema = new Schema(
  {
    companyId: {
      type: Types.ObjectId,
      ref: "Company",
    },
    name: { type: String, required: true },
    nickname: { type: String, trim: true, maxlength: 50 },
    title: { type: String, trim: true, maxlength: 100 }, // Job title or position
    designation: { type: String, trim: true, maxlength: 100 }, // Professional designation or role
    description: { type: String, trim: true, maxlength: 500 }, // User bio/description
    dob: { type: Date },
    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, select: false },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number, Number] },
    },
    image: { type: String },
    role: { type: String, default: "employee", enum: Object.values(ROLES) },
    isActive: { type: Boolean, default: true },
    isDemo: { type: Boolean, default: false },
    fcmToken: { type: String },

    // User settings
    settings: {
      type: userSettingsSchema,
      default: {} // Mongoose will apply schema defaults
    },

    // New refresh token system
    refreshTokens: [refreshTokenSchema],

    // Last login tracking
    lastLoginAt: {
      type: Date,
    },

    // Security settings
    maxActiveDevices: {
      type: Number,
      default: 5, // Maximum number of devices that can be logged in simultaneously
    },

    // Guest account expiry
    expiresAt: {
      type: Date,
      default: null, // null for regular users, Date for guests
      index: true, // For efficient cleanup queries
    },
  },
  { timestamps: true }
);

// Index for efficient token lookups
userSchema.index({ "refreshTokens.token": 1 });
userSchema.index({ "refreshTokens.expiresAt": 1 });

// register pagination plugin to user model
userSchema.plugin(mongoosePaginate);
userSchema.plugin(aggregatePaginate);

const UserModel = model("User", userSchema);

// create new user
exports.createUser = (obj) => UserModel.create(obj);

// find user by query
exports.findUser = (query) => UserModel.findOne(query);

// find multiple users by query
exports.findManyUsers = (query) => UserModel.find(query);

// update user
exports.updateUser = (query, obj) =>
  UserModel.findOneAndUpdate(query, obj, { new: true });

// get all users
exports.getAllUsers = async ({ query, page, limit, responseKey = "data" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: UserModel,
    query,
    page,
    limit,
  });

  return { [responseKey]: data, pagination };
};

// aggregate users
exports.aggregateUsers = (query) => UserModel.aggregate(query);

// generate token
exports.generateToken = (user) => {
  const token = sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRATION }
  );

  return token;
};

// generate refresh token
exports.generateRefreshToken = (user) => {
  // Generate a UUID refresh token (not JWT)
  return uuidv4();
};

// New methods for refresh token management

// Add refresh token to user (complex logic - can't use updateUser)
exports.addRefreshToken = async (userId, tokenData) => {
  const user = await UserModel.findById(userId).select("+refreshTokens");
  if (!user) {
    throw new Error("User not found");
  }

  // Create device fingerprint for comparison
  const newDeviceFingerprint = createDeviceFingerprint(tokenData.deviceInfo);

  // Check if this device already has a token
  const existingTokenIndex = user.refreshTokens.findIndex((token) => {
    const existingFingerprint = createDeviceFingerprint(token.deviceInfo);
    return existingFingerprint === newDeviceFingerprint && token.isActive;
  });

  if (existingTokenIndex !== -1) {
    // Device already has a token - replace it
    console.log("🔄 Same device detected, replacing existing token");
    user.refreshTokens[existingTokenIndex] = tokenData;
  } else {
    // New device - check device limit
    const activeTokens = user.refreshTokens.filter(
      (token) => token.isActive && token.expiresAt > new Date()
    );

    if (activeTokens.length >= user.maxActiveDevices) {
      // Remove the oldest token using correct syntax
      const oldestToken = activeTokens.sort(
        (a, b) => a.lastUsedAt - b.lastUsedAt
      )[0];
      console.log("🗑️ Device limit reached, removing oldest token");
      user.refreshTokens.pull(oldestToken._id); // ✅ Correct syntax
    }

    // Add new refresh token for new device
    console.log("📱 New device detected, adding new token");
    user.refreshTokens.push(tokenData);
  }

  user.lastLoginAt = new Date();
  return await user.save();
};

// Get active refresh tokens for user (filtering logic - can't use findUser)
exports.getActiveRefreshTokens = async (userId) => {
  const user = await UserModel.findById(userId).select("+refreshTokens");
  if (!user) {
    return [];
  }

  return user.refreshTokens.filter(
    (token) => token.isActive && token.expiresAt > new Date()
  );
};

// Clean up expired tokens (bulk operation - can't use updateUser on single user)
exports.cleanupExpiredTokens = async () => {
  return await UserModel.updateMany(
    {},
    {
      $pull: {
        refreshTokens: {
          $or: [{ expiresAt: { $lt: new Date() } }, { isActive: false }],
        },
      },
    }
  );
};

// get FcmToken
exports.getFcmToken = async (userId) => {
  const { fcmToken } = await UserModel.findById(userId);
  return fcmToken;
};

// remove user ( HARD DELETE)
exports.removeUser = (userId) => UserModel.findByIdAndDelete(userId);
