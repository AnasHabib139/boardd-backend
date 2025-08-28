"use strict";

const { parseBody, generateResponse, generateNextOrder } = require("../utils");
const { STATUS_CODES, FORM_TYPE } = require("../utils/constants");
const { findUser } = require("../models/userModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { findChannel } = require("../models/channelModel");
const {
  createForm,
  findForm,
  updateForm,
  deleteForm,
  getAllForms,
  shareFormToChannel,
  findFormsByChannel,
  findFormsByType,
} = require("../models/formModel");
const {
  createFormInvite,
  findInviteByToken,
  markAsResponded,
  updateFormInvite,
} = require("../models/formInviteModel");
const { createFormResponse } = require("../models/formResponseModel");
const Mailer = require("../utils/mailer");
const { generateFormInviteEmail } = require("../utils/emailTemplates");
const {
  createFormFavorite,
  deleteFormFavorite,
  findFormFavorite,
} = require("../models/favoriteModel");
const { upsertFormView } = require("../models/formViewModel");
const {
  buildFolderFormsQuery,
  buildFolderFavoritesQuery,
  getSortOptions,
} = require("./queries/formFolderQueries");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  HeadingLevel,
} = require("docx");
const fs = require("fs");
const path = require("path");

// Helper function to parse date strings (same as project controller)
const parseDate = (dateString) => {
  if (!dateString) return undefined;

  // If it's already a Date object, return it
  if (dateString instanceof Date) return dateString;

  // Handle DD-MM-YYYY format
  if (
    typeof dateString === "string" &&
    dateString.match(/^\d{2}-\d{2}-\d{4}$/)
  ) {
    const [day, month, year] = dateString.split("-");
    return new Date(year, month - 1, day); // month is 0-indexed
  }

  // Handle other formats (YYYY-MM-DD, ISO, etc.)
  return new Date(dateString);
};

/**
 * Create a new form
 */
exports.createForm = async (req, res, next) => {
  try {
    const {
      title,
      description,
      type,
      isFolder,
      tabId,
      channelId,
      fields,
      attachments,
      sharingSettings,
      preferences,
    } = parseBody(req.body);
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate context - if not folder creation, tabId must be provided
    if (!isFolder && !tabId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "tabId is required for channel forms",
      });
    }

    if (isFolder && tabId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Cannot specify tabId for folder forms",
      });
    }

    let tab = null;
    let channel = null;

    // If creating in channel context, validate tab and channel
    if (!isFolder && tabId) {
      tab = await findChannelTab({ _id: tabId });
      if (!tab) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Tab not found",
        });
      }

      // Check if user is a member of the tab
      if (!tab?.members?.includes(userId)) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You are not a member of this tab",
        });
      }

      // Validate channel exists and user has access
      channel = await findChannel({ _id: tab.channelId });
      if (!channel) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "Channel not found",
        });
      }
    }

    // For folder forms, no additional validation needed

    // Process fields if provided
    let processedFields = [];
    if (fields && Array.isArray(fields)) {
      // Validate field names are unique within the form
      const fieldNames = fields.map((field) => field.fieldName);
      const uniqueFieldNames = [...new Set(fieldNames)];

      if (fieldNames.length !== uniqueFieldNames.length) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Field names must be unique within the form",
        });
      }

      // Process each field and ensure proper ordering
      processedFields = fields.map((field, index) => ({
        ...field,
        order: field.order || index + 1,
        validation: field.validation || {},
        styling: field.styling || {},
      }));
    }

    // Process sharing settings with date parsing
    let processedSharingSettings = sharingSettings || {};
    if (processedSharingSettings.linkExpiry) {
      processedSharingSettings.linkExpiry = parseDate(
        processedSharingSettings.linkExpiry
      );
    }

    // Create form
    const form = await createForm({
      title,
      description: description || "",
      type: type || FORM_TYPE.FORM,
      isFolder: isFolder || false,
      tabId,
      channelId,
      createdBy: userId,
      fields: processedFields,
      attachments: attachments || [],
      sharingSettings: processedSharingSettings,
      preferences: preferences || {},
    });

    return generateResponse(
      form,
      "Form created successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in createForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get forms by tab ID with pagination
 */
exports.getFormsByTab = async (req, res, next) => {
  try {
    const { tabId } = req.params;
    const { page, limit, status } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate tab exists and user has access
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Build query
    const query = [{ $match: { tabId: tab._id, isActive: true } }];

    // Add status filter if provided
    if (status) {
      query[0].$match.status = status;
    }

    // Add user details
    query.push(
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "creator",
        },
      },
      {
        $unwind: "$creator",
      },
      {
        $project: {
          title: 1,
          description: 1,
          type: 1,
          status: 1,
          fields: 1,
          attachments: 1,
          sharingSettings: 1,
          preferences: 1,
          responseCount: 1,
          createdAt: 1,
          updatedAt: 1,
          creator: {
            _id: 1,
            name: 1,
            email: 1,
          },
        },
      },
      { $sort: { createdAt: -1 } }
    );

    const result = await getAllForms({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "forms",
    });

    return generateResponse(
      result,
      "Forms fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getFormsByTab:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get form by ID
 */
exports.getFormById = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const userId = req?.user?.id;

    // Find form
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // If user is provided, validate access
    if (userId) {
      const user = await findUser({ _id: userId });
      if (!user) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "User not found",
        });
      }

      // For folder forms (isFolder: true), check if user is in same company as form creator
      if (form.isFolder) {
        const formCreator = await findUser({ _id: form.createdBy });
        if (
          !formCreator ||
          !formCreator.companyId ||
          !user.companyId ||
          formCreator.companyId.toString() !== user.companyId.toString()
        ) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "You don't have access to this form",
          });
        }
      } else {
        // For channel forms, check tab membership
        const tab = await findChannelTab({ _id: form.tabId });
        if (!tab || !tab?.members?.includes(userId)) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "You don't have access to this form",
          });
        }
      }

      // Track last viewed (non-blocking)
      upsertFormView({ userId, formId, when: new Date() }).catch((e) => {
        console.error(
          "Failed to record last viewed for form",
          formId,
          "by user",
          userId,
          "Error:",
          e?.message
        );
      });
    }

    return generateResponse(
      form,
      "Form fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getFormById:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Update form
 */
exports.updateForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const updates = parseBody(req.body);
    const userId = req?.user?.id;

    // Find form
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Validate user has access
    const tab = await findChannelTab({ _id: form.tabId });
    if (!tab || !tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have permission to update this form",
      });
    }

    // If updating fields, validate field names are unique
    if (updates.fields && Array.isArray(updates.fields)) {
      const fieldNames = updates.fields.map((field) => field.fieldName);
      const uniqueFieldNames = [...new Set(fieldNames)];

      if (fieldNames.length !== uniqueFieldNames.length) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Field names must be unique within the form",
        });
      }
    }

    // Process sharing settings with date parsing if being updated
    if (updates.sharingSettings && updates.sharingSettings.linkExpiry) {
      updates.sharingSettings.linkExpiry = parseDate(
        updates.sharingSettings.linkExpiry
      );
    }

    // Update form
    const updatedForm = await updateForm(
      { _id: formId },
      { ...updates, updatedAt: new Date() }
    );

    return generateResponse(
      updatedForm,
      "Form updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete form (soft delete)
 */
exports.deleteForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const userId = req?.user?.id;

    // Find form
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Validate user has access (only creator or tab member can delete)
    const tab = await findChannelTab({ _id: form.tabId });
    if (!tab || !tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have permission to delete this form",
      });
    }

    // Soft delete
    await updateForm(
      { _id: formId },
      { isActive: false, updatedAt: new Date() }
    );

    return generateResponse(
      { formId },
      "Form deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Share form from folder to channel
 */
exports.shareForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const { channelId, tabId } = parseBody(req.body);
    const userId = req?.user?.id;

    // Validate required fields
    if (!channelId || !tabId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Both channelId and tabId are required",
      });
    }

    // Find form
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Check if form is in folder context (not already shared)
    if (!form.isFolder) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Form must be in folder context to be shared",
      });
    }

    // Validate user is creator or has permission
    if (form.createdBy.toString() !== userId) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have permission to share this form",
      });
    }

    // Validate tab exists and is form builder tab
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }

    // Check if user is a member of the target tab
    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of the target tab",
      });
    }

    // Validate channel exists
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Share form to channel
    const sharedForm = await shareFormToChannel(formId, channelId, tabId);

    return generateResponse(
      sharedForm,
      "Form shared to channel successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in shareForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get forms by folder context with pagination
 */
exports.getFormsByFolder = async (req, res, next) => {
  try {
    const { page, limit, type, sortBy, created_by, status } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Build aggregation query using query builder
    const query = buildFolderFormsQuery({
      user,
      type,
      created_by,
      status,
      sortBy,
    });

    const result = await getAllForms({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "forms",
      sort: getSortOptions(sortBy),
    });

    return generateResponse(
      result,
      "Folder forms fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getFormsByFolder:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Favorite a form (personalized per user)
 */
exports.favoriteForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const userId = req?.user?.id;

    // Validate form
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Validate access similar to getFormById
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    if (form.isFolder) {
      const formCreator = await findUser({ _id: form.createdBy });
      if (
        !formCreator ||
        !formCreator.companyId ||
        !user.companyId ||
        formCreator.companyId.toString() !== user.companyId.toString()
      ) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have access to this form",
        });
      }
    } else {
      const tab = await findChannelTab({ _id: form.tabId });
      if (!tab || !tab?.members?.includes(userId)) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have access to this form",
        });
      }
    }

    // Idempotent favorite
    const existing = await findFormFavorite({ userId, formId });
    if (existing) {
      return generateResponse(
        { formId, isFav: true },
        "Form already favorited",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    await createFormFavorite({ userId, formId });
    return generateResponse(
      { formId, isFav: true },
      "Form favorited",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    // Handle duplicate key gracefully
    if (error?.code === 11000) {
      return generateResponse(
        { formId: req.params.formId, isFav: true },
        "Form already favorited",
        res,
        STATUS_CODES.SUCCESS
      );
    }
    console.error("Error in favoriteForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Unfavorite a form (personalized per user)
 */
exports.unfavoriteForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const userId = req?.user?.id;

    await deleteFormFavorite({ userId, formId });
    return generateResponse(
      { formId, isFav: false },
      "Form unfavorited",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in unfavoriteForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Toggle form privacy (private/public)
 */
exports.toggleFormPrivacy = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const userId = req?.user?.id;

    // Find form
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Check if user has permission to toggle privacy
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // For folder forms, check if user is in same company as form creator
    if (form.isFolder) {
      const formCreator = await findUser({ _id: form.createdBy });
      if (
        !formCreator ||
        !formCreator.companyId ||
        !user.companyId ||
        formCreator.companyId.toString() !== user.companyId.toString()
      ) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have access to this form",
        });
      }
    } else {
      // For channel forms, check tab membership
      const tab = await findChannelTab({ _id: form.tabId });
      if (!tab || !tab?.members?.includes(userId)) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have access to this form",
        });
      }
    }

    // Toggle privacy
    const updatedForm = await updateForm(
      { _id: formId },
      { isPrivate: !form.isPrivate, updatedAt: new Date() }
    );

    return generateResponse(
      {
        formId,
        isPrivate: updatedForm.isPrivate,
        message: updatedForm.isPrivate
          ? "Form is now private"
          : "Form is now public",
      },
      "Form privacy updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in toggleFormPrivacy:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Toggle favorite (favorite if not present, otherwise unfavorite)
 */
exports.toggleFavoriteForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const userId = req?.user?.id;

    // If already favorited, unfavorite without requiring access to the form
    const existing = await findFormFavorite({ userId, formId });
    if (existing) {
      await deleteFormFavorite({ userId, formId });
      return generateResponse(
        { formId, isFav: false },
        "Form unfavorited",
        res,
        STATUS_CODES.SUCCESS
      );
    }

    // Otherwise, validate form and access before favoriting
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    if (form.isFolder) {
      const formCreator = await findUser({ _id: form.createdBy });
      const sameCompany =
        formCreator &&
        formCreator.companyId &&
        user.companyId &&
        formCreator.companyId.toString() === user.companyId.toString();
      if (!sameCompany) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have access to this form",
        });
      }
    } else {
      const tab = await findChannelTab({ _id: form.tabId });
      if (!tab || !tab?.members?.includes(userId)) {
        return next({
          statusCode: STATUS_CODES.FORBIDDEN,
          message: "You don't have access to this form",
        });
      }
    }

    await createFormFavorite({ userId, formId });
    return generateResponse(
      { formId, isFav: true },
      "Form favorited",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    if (error?.code === 11000) {
      return generateResponse(
        { formId: req.params.formId, isFav: true },
        "Form already favorited",
        res,
        STATUS_CODES.SUCCESS
      );
    }
    console.error("Error in toggleFavoriteForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get user's favorites in folder context (personalized)
 */
exports.getFolderFavorites = async (req, res, next) => {
  try {
    const { page, limit, type, sortBy, created_by, status } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Build aggregation query using query builder for favorites
    const query = buildFolderFavoritesQuery({
      user,
      type,
      created_by,
      status,
      sortBy,
    });

    const result = await getAllForms({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "forms",
      sort: getSortOptions(sortBy),
    });

    return generateResponse(
      result,
      "Favorites fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getFolderFavorites:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Download form as DOCX file
 */
exports.downloadForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const { format = "docx" } = req.query; // Support for future formats
    const userId = req?.user?.id;

    // Find form
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Validate user has access
    if (userId) {
      const user = await findUser({ _id: userId });
      if (!user) {
        return next({
          statusCode: STATUS_CODES.NOT_FOUND,
          message: "User not found",
        });
      }

      // For folder forms (isFolder: true), check if user is in same company as form creator
      if (form.isFolder) {
        const formCreator = await findUser({ _id: form.createdBy });
        if (
          !formCreator ||
          !formCreator.companyId ||
          !user.companyId ||
          formCreator.companyId.toString() !== user.companyId.toString()
        ) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "You don't have access to download this form",
          });
        }
      } else {
        // For channel forms, check tab membership
        const tab = await findChannelTab({ _id: form.tabId });
        if (!tab || !tab?.members?.includes(userId)) {
          return next({
            statusCode: STATUS_CODES.FORBIDDEN,
            message: "You don't have access to download this form",
          });
        }
      }
    }

    // Get creator info for form metadata
    const creator = await findUser({ _id: form.createdBy });
    let tab = null;
    let channel = null;

    // Only get tab/channel info for channel forms
    if (!form.isFolder && form.tabId) {
      tab = await findChannelTab({ _id: form.tabId });
      if (tab) {
        channel = await findChannel({ _id: tab.channelId });
      }
    }

    if (format.toLowerCase() === "docx") {
      return await generateDocxDownload(form, creator, tab, channel, res);
    } else {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Unsupported format. Only 'docx' is currently supported.",
      });
    }
  } catch (error) {
    console.error("Error in downloadForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to download form",
    });
  }
};

/**
 * Generate DOCX file and send as download
 */
const generateDocxDownload = async (form, creator, tab, channel, res) => {
  try {
    // Create document sections
    const children = [];

    // Title Section with styling
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: form.title,
            bold: true,
            size: 40, // 20pt
            color: "2E5C8E", // Professional blue
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // Form Type
    if (form.type && form.type.trim() !== "") {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: form.type,
              italics: true,
              size: 28, // 14pt
              color: "666666",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        })
      );
    }

    // Description
    if (form.description && form.description.trim() !== "") {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: form.description,
              size: 24, // 12pt
              color: "333333",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        })
      );
    }

    // Instructions
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Please fill out the form below:",
            size: 22,
            color: "666666",
            italics: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 800 },
      })
    );

    // Form Fields - Render as actual form fields
    if (form.fields && form.fields.length > 0) {
      // Sort fields by order
      const sortedFields = [...form.fields].sort(
        (a, b) => (a.order || 0) - (b.order || 0)
      );

      sortedFields.forEach((field, index) => {
        // Parse field styling
        const fieldStyling = field.styling || {};
        const fieldValidation = field.validation || {};

        // Determine field colors
        const labelColor = fieldStyling.color || "333333";
        const fieldBackgroundColor = fieldStyling.backgroundColor || "F8F9FA";

        // Determine font size
        let fontSize = 24; // Default 12pt
        if (fieldStyling.fontSize === "small") fontSize = 20; // 10pt
        if (fieldStyling.fontSize === "large") fontSize = 28; // 14pt

        // Determine text alignment
        let textAlignment = AlignmentType.LEFT;
        if (fieldStyling.textAlign === "center")
          textAlignment = AlignmentType.CENTER;
        if (fieldStyling.textAlign === "right")
          textAlignment = AlignmentType.RIGHT;
        if (fieldStyling.textAlign === "justify")
          textAlignment = AlignmentType.JUSTIFIED;

        // Field Label with styling
        const labelChildren = [
          new TextRun({
            text: field.label,
            bold: fieldStyling.fontWeight === "bold" || true,
            size: fontSize + 2, // Slightly larger for label
            color: labelColor,
            font: fieldStyling.fontFamily || "Arial",
          }),
        ];

        // Add required asterisk if field is required
        if (fieldValidation.required) {
          labelChildren.push(
            new TextRun({
              text: " *",
              bold: true,
              size: fontSize + 2,
              color: "E74C3C", // Red
            })
          );
        }

        children.push(
          new Paragraph({
            children: labelChildren,
            alignment: textAlignment,
            spacing: { before: 400, after: 150 },
          })
        );

        // Field Description (if exists)
        if (
          fieldStyling.description &&
          fieldStyling.description.trim() !== ""
        ) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: fieldStyling.description,
                  size: fontSize - 2, // Smaller than field
                  color: "666666",
                  italics: true,
                  font: fieldStyling.fontFamily || "Arial",
                }),
              ],
              alignment: textAlignment,
              spacing: { after: 100 },
              indent: { left: 200 },
            })
          );
        }

        // Render field based on type
        switch (field.type.toLowerCase()) {
          case "text":
          case "email":
          case "phone":
          case "url":
            // Text input field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text:
                      fieldStyling.placeholder ||
                      `Enter ${field.label.toLowerCase()}...`,
                    size: fontSize,
                    color: "999999",
                    italics: true,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
                shading: {
                  fill: fieldBackgroundColor,
                },
                border: {
                  top: { style: "single", size: 1, color: "CCCCCC" },
                  bottom: { style: "single", size: 1, color: "CCCCCC" },
                  left: { style: "single", size: 1, color: "CCCCCC" },
                  right: { style: "single", size: 1, color: "CCCCCC" },
                },
              })
            );

            // Add underline for writing space
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "____________________________________________",
                    size: fontSize,
                    color: "CCCCCC",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 300 },
                indent: { left: 200 },
              })
            );
            break;

          case "textarea":
            // Multi-line text area
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text:
                      fieldStyling.placeholder ||
                      `Enter ${field.label.toLowerCase()}...`,
                    size: fontSize,
                    color: "999999",
                    italics: true,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
                shading: {
                  fill: fieldBackgroundColor,
                },
                border: {
                  top: { style: "single", size: 1, color: "CCCCCC" },
                  bottom: { style: "single", size: 1, color: "CCCCCC" },
                  left: { style: "single", size: 1, color: "CCCCCC" },
                  right: { style: "single", size: 1, color: "CCCCCC" },
                },
              })
            );

            // Add multiple lines for writing
            for (let i = 0; i < 4; i++) {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "____________________________________________",
                      size: fontSize,
                      color: "CCCCCC",
                    }),
                  ],
                  alignment: textAlignment,
                  spacing: { after: 100 },
                  indent: { left: 200 },
                })
              );
            }
            children.push(
              new Paragraph({
                children: [new TextRun({ text: "" })],
                spacing: { after: 200 },
              })
            );
            break;

          case "number":
            // Number input field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: fieldStyling.placeholder || "Enter number...",
                    size: fontSize,
                    color: "999999",
                    italics: true,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
                shading: {
                  fill: fieldBackgroundColor,
                },
                border: {
                  top: { style: "single", size: 1, color: "CCCCCC" },
                  bottom: { style: "single", size: 1, color: "CCCCCC" },
                  left: { style: "single", size: 1, color: "CCCCCC" },
                  right: { style: "single", size: 1, color: "CCCCCC" },
                },
              })
            );

            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "____________",
                    size: fontSize,
                    color: "CCCCCC",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 300 },
                indent: { left: 200 },
              })
            );
            break;

          case "select":
            // Dropdown/Select field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Select an option:",
                    size: fontSize,
                    color: labelColor,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
              })
            );

            if (field.options && field.options.length > 0) {
              field.options.forEach((option, optIndex) => {
                children.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `☐ ${option}`,
                        size: fontSize,
                        color: labelColor,
                        font: fieldStyling.fontFamily || "Arial",
                      }),
                    ],
                    alignment: textAlignment,
                    spacing: { after: 80 },
                    indent: { left: 400 },
                  })
                );
              });
            }
            children.push(
              new Paragraph({
                children: [new TextRun({ text: "" })],
                spacing: { after: 200 },
              })
            );
            break;

          case "radio":
            // Radio button field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Choose one option:",
                    size: fontSize,
                    color: labelColor,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
              })
            );

            if (field.options && field.options.length > 0) {
              field.options.forEach((option, optIndex) => {
                children.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `○ ${option}`,
                        size: fontSize,
                        color: labelColor,
                        font: fieldStyling.fontFamily || "Arial",
                      }),
                    ],
                    alignment: textAlignment,
                    spacing: { after: 80 },
                    indent: { left: 400 },
                  })
                );
              });
            }
            children.push(
              new Paragraph({
                children: [new TextRun({ text: "" })],
                spacing: { after: 200 },
              })
            );
            break;

          case "checkbox":
            // Checkbox field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Select all that apply:",
                    size: fontSize,
                    color: labelColor,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
              })
            );

            if (field.options && field.options.length > 0) {
              field.options.forEach((option, optIndex) => {
                children.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `☐ ${option}`,
                        size: fontSize,
                        color: labelColor,
                        font: fieldStyling.fontFamily || "Arial",
                      }),
                    ],
                    alignment: textAlignment,
                    spacing: { after: 80 },
                    indent: { left: 400 },
                  })
                );
              });
            }
            children.push(
              new Paragraph({
                children: [new TextRun({ text: "" })],
                spacing: { after: 200 },
              })
            );
            break;

          case "date":
            // Date field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Date: _____ / _____ / _________",
                    size: fontSize,
                    color: labelColor,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
              })
            );

            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "      (DD)     (MM)      (YYYY)",
                    size: fontSize - 4,
                    color: "999999",
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 300 },
                indent: { left: 200 },
              })
            );
            break;

          case "time":
            // Time field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Time: _____ : _____ ☐ AM ☐ PM",
                    size: fontSize,
                    color: labelColor,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
              })
            );

            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "         (HH)     (MM)",
                    size: fontSize - 4,
                    color: "999999",
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 300 },
                indent: { left: 200 },
              })
            );
            break;

          case "file":
            // File upload field
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Attach file: [ Browse... ] ________________",
                    size: fontSize,
                    color: labelColor,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 300 },
                indent: { left: 200 },
                shading: {
                  fill: fieldBackgroundColor,
                },
                border: {
                  top: { style: "single", size: 1, color: "CCCCCC" },
                  bottom: { style: "single", size: 1, color: "CCCCCC" },
                  left: { style: "single", size: 1, color: "CCCCCC" },
                  right: { style: "single", size: 1, color: "CCCCCC" },
                },
              })
            );
            break;

          default:
            // Default field rendering
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: fieldStyling.placeholder || `${field.type} field`,
                    size: fontSize,
                    color: "999999",
                    italics: true,
                    font: fieldStyling.fontFamily || "Arial",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 100 },
                indent: { left: 200 },
                shading: {
                  fill: fieldBackgroundColor,
                },
                border: {
                  top: { style: "single", size: 1, color: "CCCCCC" },
                  bottom: { style: "single", size: 1, color: "CCCCCC" },
                  left: { style: "single", size: 1, color: "CCCCCC" },
                  right: { style: "single", size: 1, color: "CCCCCC" },
                },
              })
            );

            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "____________________________________________",
                    size: fontSize,
                    color: "CCCCCC",
                  }),
                ],
                alignment: textAlignment,
                spacing: { after: 300 },
                indent: { left: 200 },
              })
            );
            break;
        }

        // Add spacing between fields
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "" })],
            spacing: { after: 400 },
          })
        );
      });
    }

    // Form footer
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "" })],
        spacing: { after: 400 },
        border: {
          top: {
            color: "CCCCCC",
            size: 1,
            style: "single",
          },
        },
      })
    );

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Thank you for completing this form!",
            size: 24,
            color: "2E5C8E",
            bold: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 400 },
      })
    );

    // Metadata footer
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Form created by ${
              creator?.name || creator?.email || "Unknown"
            }${
              channel && tab
                ? ` | ${channel?.channelName} / ${tab?.tabName}`
                : " | Folder Form"
            } | Generated: ${new Date().toLocaleDateString()}`,
            size: 16,
            color: "999999",
            italics: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 600 },
      })
    );

    // Create the document
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
          children: children,
        },
      ],
    });

    // Generate buffer
    const buffer = await Packer.toBuffer(doc);

    // Generate filename
    const sanitizedTitle = form.title
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "_");
    const filename = `${sanitizedTitle}_Form_${
      new Date().toISOString().split("T")[0]
    }.docx`;

    // Set response headers for download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);

    // Send the file
    res.send(buffer);
  } catch (error) {
    console.error("Error generating DOCX:", error);
    throw error;
  }
};

/**
 * Share form (exactly like task sharing)
 */
exports.shareForm = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const { emails, names, message, shareType = "both" } = parseBody(req.body);
    const userId = req?.user?.id;

    // Validate form exists
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Get current user for context
    const currentUser = await findUser({ _id: userId });
    if (!currentUser) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check permissions based on form type
    let hasAccess = false;
    if (form.isFolder) {
      // For folder forms, check if user is in same company as form creator
      const formCreator = await findUser({ _id: form.createdBy });
      hasAccess =
        formCreator &&
        formCreator.companyId &&
        currentUser.companyId &&
        formCreator.companyId.toString() === currentUser.companyId.toString();
    } else {
      // For channel forms, check tab membership
      const tab = await findChannelTab({ _id: form.tabId });
      hasAccess = tab && tab.members.includes(userId);
    }

    if (!hasAccess) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have permission to share this form",
      });
    }

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    // Generate shareable link without token for link sharing
    // Users will get tokens dynamically via /api/forms/:formId/token
    const shareLink = `${baseUrl}/form/${formId}`;

    // Prepare response
    const response = {
      shareLink,
      form: {
        id: form._id,
        title: form.title,
        description: form.description,
      },
      sharedBy: {
        name: currentUser.name,
        email: currentUser.email,
      },
    };

    // Handle email sharing if emails provided
    if (
      emails &&
      Array.isArray(emails) &&
      emails.length > 0 &&
      (shareType === "email" || shareType === "both")
    ) {
      // Validate emails array
      const uniqueEmails = [...new Set(emails)];
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = uniqueEmails.filter(
        (email) => !emailRegex.test(email)
      );

      if (invalidEmails.length > 0) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Invalid email format: ${invalidEmails.join(", ")}`,
        });
      }

      if (uniqueEmails.length > 20) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Cannot share with more than 20 recipients at once",
        });
      }

      const emailResults = [];
      const emailErrors = [];

      // Process each email with corresponding name
      for (let i = 0; i < uniqueEmails.length; i++) {
        const email = uniqueEmails[i];
        const name = (names && names[i]) || email.split("@")[0]; // Use provided name or fallback

        try {
          // Create form invite for tracking
          const formInvite = await createFormInvite({
            formId,
            invitedBy: userId,
            invitedEmail: email.toLowerCase(),
            invitedName: name,
            customMessage: message,
            shareMethod: "email",
          });

          // Generate personalized link with token
          const personalizedLink = `${baseUrl}/form/${formId}?token=${formInvite.inviteToken}`;

          // Generate email template
          const emailTemplate = generateFormInviteEmail({
            formTitle: form.title,
            formDescription: form.description,
            sharedByName: currentUser.name,
            shareLink: personalizedLink,
            customMessage: message || "",
            recipientName: name,
          });

          await Mailer.sendEmail({
            email: email,
            subject: `${currentUser.name} shared a form with you: ${form.title}`,
            message: emailTemplate.text,
            html: emailTemplate.html,
            replyTo: currentUser.email,
          });

          // Update invite as email sent
          await updateFormInvite(
            { _id: formInvite._id },
            { emailSent: true, emailSentAt: new Date() }
          );

          emailResults.push({ email, name });
        } catch (emailError) {
          console.error(`Failed to send email to ${email}:`, emailError);
          emailErrors.push(
            `Failed to send email to ${email}: ${emailError.message}`
          );
        }
      }

      response.emailResults = {
        sent: emailResults,
        failed: emailErrors,
        totalSent: emailResults.length,
        totalRequested: uniqueEmails.length,
      };

      if (emailErrors.length > 0) {
        response.emailResults.errors = emailErrors;
      }
    }

    // Determine response message
    let responseMessage = "Form shared successfully";
    if (shareType === "email" && response.emailResults) {
      const { totalSent, totalRequested } = response.emailResults;
      if (totalSent === totalRequested) {
        responseMessage = `Form shared via email with ${totalSent} recipients`;
      } else if (totalSent > 0) {
        responseMessage = `Form shared with ${totalSent} out of ${totalRequested} recipients`;
      } else {
        responseMessage = "Failed to send form emails";
      }
    } else if (shareType === "both" && response.emailResults) {
      responseMessage = `Form link generated and shared via email with ${response.emailResults.totalSent} recipients`;
    }

    return generateResponse(
      response,
      responseMessage,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in shareForm:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to share form",
    });
  }
};

/**
 * Generate anonymous token for link access
 */
exports.generateFormToken = async (req, res, next) => {
  try {
    const { formId } = req.params;

    // Validate form exists and is active
    const form = await findForm({ _id: formId, isActive: true });
    if (!form) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Form not found",
      });
    }

    // Generate anonymous invite for this user session
    const anonymousInvite = await createFormInvite({
      formId,
      invitedBy: form.createdBy, // Use form creator as invitedBy
      invitedEmail: `anonymous-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}@link.share`,
      invitedName: "Anonymous User",
      customMessage: null,
      shareMethod: "anonymous",
    });

    return generateResponse(
      {
        token: anonymousInvite.inviteToken,
        formId: formId,
      },
      "Anonymous token generated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in generateFormToken:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to generate form token",
    });
  }
};

/**
 * Submit form response
 */
exports.submitFormResponse = async (req, res, next) => {
  try {
    const { formId } = req.params;
    const { token, responses } = parseBody(req.body);

    if (!token) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Token is required",
      });
    }

    if (!responses || !Array.isArray(responses) || responses.length === 0) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Responses are required",
      });
    }

    // Find invite by token
    const invite = await findInviteByToken(token);
    if (!invite) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Invalid or expired invite token",
      });
    }

    // Verify form ID matches
    if (invite.formId._id.toString() !== formId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Token does not match form",
      });
    }

    // Check if already responded
    if (invite.hasResponded) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You have already responded to this form",
      });
    }

    // Validate responses against form fields
    const form = invite.formId;
    const formFieldsMap = new Map();
    form.fields.forEach((field) => {
      formFieldsMap.set(field.fieldName, field);
    });

    // Validate each response
    const validatedResponses = [];
    for (const response of responses) {
      const { fieldName, value } = response;
      const formField = formFieldsMap.get(fieldName);

      if (!formField) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Invalid field: ${fieldName}`,
        });
      }

      // Basic validation (you can expand this)
      if (formField.validation?.required && (!value || value === "")) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: `Field '${formField.label}' is required`,
        });
      }

      validatedResponses.push({
        fieldName,
        fieldType: formField.type,
        label: formField.label,
        value,
      });
    }

    // Create form response
    const formResponse = await createFormResponse({
      formId,
      inviteToken: token,
      responses: validatedResponses,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    // Mark invite as responded
    await markAsResponded(token, formResponse._id);

    // Update form response count
    await updateForm({ _id: formId }, { $inc: { responseCount: 1 } });

    return generateResponse(
      { responseId: formResponse._id },
      "Form response submitted successfully",
      res,
      STATUS_CODES.CREATED
    );
  } catch (error) {
    console.error("Error in submitFormResponse:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
