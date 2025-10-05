"use strict";

/**
 * Chat Content Validator Service
 * Validates and sanitizes contentDoc (TipTap JSON) for security and structure
 */

// Allowed node types
const ALLOWED_NODES = [
  "doc",
  "paragraph",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
  "codeBlock",
  "mention",
];

// Allowed mark types
const ALLOWED_MARKS = ["bold", "italic", "strike", "code", "link"];

/**
 * Validate and sanitize contentDoc
 * Strips unknown nodes, marks, and dangerous attributes
 * @param {Object} contentDoc - TipTap JSON document
 * @param {Object} options - Validation options { conversationType?, conversationId? }
 * @returns {Object} { isValid: boolean, sanitized: Object, errors: Array }
 */
exports.validateAndSanitize = (contentDoc, options = {}) => {
  const errors = [];

  // Basic structure validation
  if (!contentDoc || typeof contentDoc !== "object") {
    return {
      isValid: false,
      sanitized: null,
      errors: ["contentDoc must be an object"],
    };
  }

  if (contentDoc.type !== "doc") {
    return {
      isValid: false,
      sanitized: null,
      errors: ["contentDoc must have type 'doc'"],
    };
  }

  // Sanitize the document recursively
  const sanitized = sanitizeNode(contentDoc, errors, options);

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
  };
};

/**
 * Sanitize a single node recursively
 * @param {Object} node - Node to sanitize
 * @param {Array} errors - Error accumulator
 * @param {Object} options - Validation options
 * @returns {Object} Sanitized node
 */
function sanitizeNode(node, errors = [], options = {}) {
  if (!node || typeof node !== "object") {
    return null;
  }

  const { type, content, text, marks, attrs } = node;

  // Check if node type is allowed
  if (type && !ALLOWED_NODES.includes(type)) {
    errors.push(`Unknown node type: ${type}`);
    return null; // Remove unknown nodes
  }

  const sanitized = { type };

  // Sanitize text content
  if (text !== undefined) {
    sanitized.text = String(text);
  }

  // Sanitize marks
  if (marks && Array.isArray(marks)) {
    sanitized.marks = marks
      .map((mark) => sanitizeMark(mark, errors))
      .filter((mark) => mark !== null);

    if (sanitized.marks.length === 0) {
      delete sanitized.marks;
    }
  }

  // Sanitize attributes
  if (attrs) {
    sanitized.attrs = sanitizeAttrs(type, attrs, errors, options);
  }

  // Recursively sanitize child content
  if (content && Array.isArray(content)) {
    sanitized.content = content
      .map((child) => sanitizeNode(child, errors, options))
      .filter((child) => child !== null);

    if (sanitized.content.length === 0) {
      delete sanitized.content;
    }
  }

  // Validate structure constraints
  validateStructure(sanitized, errors);

  return sanitized;
}

/**
 * Sanitize mark
 * @param {Object} mark - Mark to sanitize
 * @param {Array} errors - Error accumulator
 * @returns {Object|null} Sanitized mark or null if invalid
 */
function sanitizeMark(mark, errors = []) {
  if (!mark || typeof mark !== "object" || !mark.type) {
    return null;
  }

  if (!ALLOWED_MARKS.includes(mark.type)) {
    errors.push(`Unknown mark type: ${mark.type}`);
    return null;
  }

  const sanitized = { type: mark.type };

  // Sanitize mark attributes
  if (mark.attrs) {
    if (mark.type === "link") {
      sanitized.attrs = sanitizeLinkAttrs(mark.attrs, errors);
    } else {
      // Other marks shouldn't have attrs
      delete sanitized.attrs;
    }
  }

  return sanitized;
}

/**
 * Sanitize node attributes based on node type
 * @param {String} nodeType - Type of node
 * @param {Object} attrs - Attributes to sanitize
 * @param {Array} errors - Error accumulator
 * @param {Object} options - Validation options
 * @returns {Object} Sanitized attributes
 */
function sanitizeAttrs(nodeType, attrs, errors = [], options = {}) {
  const sanitized = {};

  switch (nodeType) {
    case "mention":
      // Validate mention attributes
      if (attrs.id && attrs.label) {
        sanitized.id = String(attrs.id);
        sanitized.label = String(attrs.label);
        sanitized.type = attrs.type || "user";

        // Validate mention type
        if (!["user", "channel"].includes(sanitized.type)) {
          sanitized.type = "user";
        }

        // Validate @channel mentions
        if (sanitized.id === "@channel") {
          sanitized.type = "channel";

          // @channel only allowed in channel conversations
          if (options.conversationType && options.conversationType !== "channel") {
            errors.push("@channel mentions are only allowed in channel conversations");
            return null;
          }
        }
      } else {
        errors.push("Mention node missing required attributes (id, label)");
        return null;
      }
      break;

    case "codeBlock":
      // Validate code block language
      if (attrs.language) {
        sanitized.language = String(attrs.language).toLowerCase();
      }
      break;

    case "orderedList":
      // Validate ordered list start number
      if (attrs.start !== undefined) {
        const start = parseInt(attrs.start, 10);
        sanitized.start = !isNaN(start) ? start : 1;
      }
      break;

    default:
      // Other node types don't have special attrs
      break;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Sanitize link attributes to prevent XSS
 * @param {Object} attrs - Link attributes
 * @param {Array} errors - Error accumulator
 * @returns {Object} Sanitized link attributes
 */
function sanitizeLinkAttrs(attrs, errors = []) {
  const sanitized = {};

  if (attrs.href) {
    const href = String(attrs.href).trim();

    // Prevent javascript: and data: URLs
    if (
      href.toLowerCase().startsWith("javascript:") ||
      href.toLowerCase().startsWith("data:") ||
      href.toLowerCase().startsWith("vbscript:")
    ) {
      errors.push("Dangerous link href detected and removed");
      return null;
    }

    // Only allow http, https, mailto
    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:") ||
      href.startsWith("/") ||
      href.startsWith("#")
    ) {
      sanitized.href = href;
    } else {
      errors.push(`Invalid link protocol: ${href}`);
      return null;
    }
  }

  // Allow target attribute (but sanitize it)
  if (attrs.target) {
    const target = String(attrs.target);
    if (["_blank", "_self", "_parent", "_top"].includes(target)) {
      sanitized.target = target;
    }
  }

  // Allow rel attribute (for security)
  if (attrs.rel) {
    sanitized.rel = String(attrs.rel);
  } else if (sanitized.target === "_blank") {
    // Add security attributes for _blank links
    sanitized.rel = "noopener noreferrer";
  }

  return sanitized;
}

/**
 * Validate structural constraints
 * @param {Object} node - Node to validate
 * @param {Array} errors - Error accumulator
 */
function validateStructure(node, errors = []) {
  if (!node || !node.type) return;

  // listItem must be inside bulletList or orderedList
  // This is checked at parent level, so we just verify content exists for lists
  if (node.type === "bulletList" || node.type === "orderedList") {
    if (!node.content || node.content.length === 0) {
      errors.push(`${node.type} must have at least one listItem`);
    } else {
      // Check that all children are listItems
      const invalidChildren = node.content.filter((child) => child.type !== "listItem");
      if (invalidChildren.length > 0) {
        errors.push(`${node.type} can only contain listItem nodes`);
      }
    }
  }

  // listItem must contain paragraph or other block content
  if (node.type === "listItem") {
    if (!node.content || node.content.length === 0) {
      errors.push("listItem must have content");
    }
  }

  // text nodes must have text content
  if (node.type === "text" && !node.text) {
    errors.push("text node must have text content");
  }

  // doc must have content
  if (node.type === "doc" && (!node.content || node.content.length === 0)) {
    errors.push("doc must have content");
  }
}

/**
 * Extract all mention IDs from contentDoc
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {Object} { userMentions: [userId], channelMention: boolean }
 */
exports.extractMentions = (contentDoc) => {
  const userMentions = [];
  let channelMention = false;

  function traverse(node) {
    if (!node || typeof node !== "object") return;

    if (node.type === "mention" && node.attrs) {
      if (node.attrs.id === "@channel" && node.attrs.type === "channel") {
        channelMention = true;
      } else if (node.attrs.type === "user" && node.attrs.id) {
        userMentions.push(node.attrs.id);
      }
    }

    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }

  traverse(contentDoc);

  return {
    userMentions: [...new Set(userMentions)], // Remove duplicates
    channelMention,
  };
};

/**
 * Validate contentDoc is not empty (has meaningful content)
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {Boolean} True if content is not empty
 */
exports.hasContent = (contentDoc) => {
  if (!contentDoc || !contentDoc.content) return false;

  function hasText(node) {
    if (!node) return false;

    if (node.type === "text" && node.text && node.text.trim().length > 0) {
      return true;
    }

    if (node.content && Array.isArray(node.content)) {
      return node.content.some(hasText);
    }

    return false;
  }

  return hasText(contentDoc);
};
