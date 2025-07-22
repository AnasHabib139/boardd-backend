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
  getAllFolderForms,
  shareFormToChannel,
  findFormsByChannel,
  findFormsByType,
} = require("../models/formModel");
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
        if (!formCreator || !formCreator.companyId || !user.companyId || 
            formCreator.companyId.toString() !== user.companyId.toString()) {
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
    const { page, limit, type } = req.query;
    const userId = req?.user?.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Build aggregation query - get all folder forms from same company
    const query = [
      {
        $match: {
          isFolder: true,
          isActive: true,
        },
      },
    ];

    // Add type filter if provided
    if (type && Object.values(FORM_TYPE).includes(type)) {
      query[0].$match.type = type;
    }

    // Add user details lookup
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
        $match: {
          "creator.companyId": user.companyId,
        },
      },
      {
        $project: {
          title: 1,
          description: 1,
          type: 1,
          status: 1,
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

    const result = await getAllFolderForms({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "forms",
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
        if (!formCreator || !formCreator.companyId || !user.companyId || 
            formCreator.companyId.toString() !== user.companyId.toString()) {
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
            }${channel && tab ? ` | ${channel?.channelName} / ${tab?.tabName}` : " | Folder Form"} | Generated: ${new Date().toLocaleDateString()}`,
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
