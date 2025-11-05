"use strict";

const { generateResponse } = require("../../utils");
const { STATUS_CODES } = require("../../utils/constants");
const stripeService = require("../services/stripe.service");

/**
 * Upload branding file (icon or logo)
 * POST /api/payments/connect/accounts/:companyId/branding/upload
 */
exports.uploadBrandingFile = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { purpose } = req.body; // 'business_logo' or 'business_icon'
    const userId = req.user.id;

    console.log(`Uploading branding file for company: ${companyId}, purpose: ${purpose}`);

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to modify this account",
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "File is required",
      });
    }

    // Upload to Stripe (upload to connected account, not platform)
    const result = await stripeService.uploadBrandingFile(companyId, req.file, purpose);

    return generateResponse(
      {
        fileId: result.fileId,
        filename: result.filename,
        url: result.url,
        size: result.size,
        purpose: result.purpose,
      },
      "Branding file uploaded successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in uploadBrandingFile controller:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to upload branding file",
    });
  }
};

/**
 * Update branding settings
 * PUT /api/payments/connect/accounts/:companyId/branding
 */
exports.updateBranding = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.id;
    const brandingData = req.validatedBody;

    console.log(`Updating branding for company: ${companyId}`);

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to modify this account",
      });
    }

    const result = await stripeService.updateBrandingSettings(companyId, brandingData);

    return generateResponse(
      {
        accountId: result.accountId,
        branding: result.branding,
      },
      "Branding settings updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateBranding controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to update branding settings",
    });
  }
};

/**
 * Get current branding settings
 * GET /api/payments/connect/accounts/:companyId/branding
 */
exports.getBranding = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const userId = req.user.id;

    console.log(`Fetching branding for company: ${companyId}`);

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to view this account",
      });
    }

    const result = await stripeService.getBrandingSettings(companyId);

    return generateResponse(
      {
        accountId: result.accountId,
        branding: result.branding,
      },
      "Branding settings retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getBranding controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to fetch branding settings",
    });
  }
};

/**
 * Remove branding asset (icon or logo)
 * DELETE /api/payments/connect/accounts/:companyId/branding/:type
 */
exports.removeBrandingAsset = async (req, res, next) => {
  try {
    const { companyId, type } = req.params;
    const userId = req.user.id;

    console.log(`Removing branding ${type} for company: ${companyId}`);

    // Fetch user to get companyId (JWT doesn't include it)
    const { model } = require("mongoose");
    const UserModel = model("User");
    const user = await UserModel.findById(userId).select("companyId");

    if (!user) {
      return next({
        statusCode: STATUS_CODES.UNAUTHORIZED,
        message: "User not found",
      });
    }

    // Security check
    if (companyId !== user.companyId.toString()) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You do not have permission to modify this account",
      });
    }

    // Validate type
    if (!["icon", "logo"].includes(type)) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid type. Must be 'icon' or 'logo'",
      });
    }

    const result = await stripeService.removeBrandingAsset(companyId, type);

    return generateResponse(
      {
        accountId: result.accountId,
        removed: result.removed,
        branding: result.branding,
      },
      `Branding ${type} removed successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in removeBrandingAsset controller:", error);

    if (error.message.includes("not found")) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Stripe account not found for this company",
      });
    }

    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to remove branding asset",
    });
  }
};
