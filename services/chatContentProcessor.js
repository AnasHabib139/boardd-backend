"use strict";

/**
 * Chat Content Processor Service
 * Processes contentDoc to derive plaintext and extract URLs
 */

/**
 * Convert contentDoc to plaintext for search and previews
 * @param {Object} contentDoc - TipTap JSON document
 * @param {Object} options - Processing options { maxLength?, preserveNewlines? }
 * @returns {String} Plaintext representation
 */
exports.deriveContentText = (contentDoc, options = {}) => {
  const { maxLength = null, preserveNewlines = false } = options;

  if (!contentDoc || typeof contentDoc !== "object") {
    return "";
  }

  const textParts = [];

  function traverse(node, depth = 0) {
    if (!node || typeof node !== "object") return;

    // Extract text from text nodes
    if (node.type === "text" && node.text) {
      textParts.push(node.text);
      return;
    }

    // Handle mentions
    if (node.type === "mention" && node.attrs) {
      textParts.push(`@${node.attrs.label || node.attrs.id}`);
      return;
    }

    // Handle hard breaks
    if (node.type === "hardBreak") {
      textParts.push(preserveNewlines ? "\n" : " ");
      return;
    }

    // Handle block elements with spacing
    if (
      node.type === "paragraph" ||
      node.type === "blockquote" ||
      node.type === "codeBlock" ||
      node.type === "listItem"
    ) {
      if (textParts.length > 0 && textParts[textParts.length - 1] !== "\n") {
        textParts.push(preserveNewlines ? "\n" : " ");
      }
    }

    // Recursively process child content
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child) => traverse(child, depth + 1));
    }

    // Add spacing after block elements
    if (
      node.type === "paragraph" ||
      node.type === "blockquote" ||
      node.type === "codeBlock"
    ) {
      if (textParts.length > 0 && textParts[textParts.length - 1] !== "\n") {
        textParts.push(preserveNewlines ? "\n" : " ");
      }
    }
  }

  traverse(contentDoc);

  // Join and clean up text
  let text = textParts.join("");

  // Remove multiple spaces
  text = text.replace(/[ ]+/g, " ");

  // Remove multiple newlines if preserving
  if (preserveNewlines) {
    text = text.replace(/\n{3,}/g, "\n\n");
  }

  // Trim
  text = text.trim();

  // Truncate if maxLength specified
  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength) + "...";
  }

  return text;
};

/**
 * Extract all URLs from link marks in contentDoc
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {Array<String>} Array of unique URLs
 */
exports.extractLinks = (contentDoc) => {
  if (!contentDoc || typeof contentDoc !== "object") {
    return [];
  }

  const links = [];

  function traverse(node) {
    if (!node || typeof node !== "object") return;

    // Check if this is a text node with link mark
    if (node.marks && Array.isArray(node.marks)) {
      node.marks.forEach((mark) => {
        if (mark.type === "link" && mark.attrs && mark.attrs.href) {
          links.push(mark.attrs.href);
        }
      });
    }

    // Recursively process child content
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }

  traverse(contentDoc);

  // Return unique URLs
  return [...new Set(links)];
};

/**
 * Generate a short preview of the message for notifications
 * @param {Object} contentDoc - TipTap JSON document
 * @param {Number} maxLength - Maximum length of preview (default: 100)
 * @returns {String} Preview text
 */
exports.generatePreview = (contentDoc, maxLength = 100) => {
  const text = exports.deriveContentText(contentDoc, { preserveNewlines: false });

  if (text.length <= maxLength) {
    return text;
  }

  // Find last space before maxLength to avoid cutting words
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength * 0.8) {
    // If space is close to max length, use it
    return truncated.substring(0, lastSpace) + "...";
  }

  // Otherwise, just truncate
  return truncated + "...";
};

/**
 * Extract code blocks from contentDoc
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {Array<Object>} Array of code blocks { language, code }
 */
exports.extractCodeBlocks = (contentDoc) => {
  if (!contentDoc || typeof contentDoc !== "object") {
    return [];
  }

  const codeBlocks = [];

  function traverse(node) {
    if (!node || typeof node !== "object") return;

    if (node.type === "codeBlock") {
      const language = node.attrs?.language || "plaintext";
      const code = node.content
        ? node.content.map((child) => child.text || "").join("")
        : "";

      codeBlocks.push({ language, code });
    }

    // Recursively process child content
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }

  traverse(contentDoc);

  return codeBlocks;
};

/**
 * Check if message contains specific content type
 * @param {Object} contentDoc - TipTap JSON document
 * @param {String} type - Content type to check (link, mention, codeBlock, list, etc.)
 * @returns {Boolean}
 */
exports.hasContentType = (contentDoc, type) => {
  if (!contentDoc || typeof contentDoc !== "object") {
    return false;
  }

  let found = false;

  function traverse(node) {
    if (!node || typeof node !== "object" || found) return;

    if (node.type === type) {
      found = true;
      return;
    }

    // For marks (like links)
    if (node.marks && Array.isArray(node.marks)) {
      if (node.marks.some((mark) => mark.type === type)) {
        found = true;
        return;
      }
    }

    // Recursively process child content
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }

  traverse(contentDoc);

  return found;
};

/**
 * Count words in message
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {Number} Word count
 */
exports.countWords = (contentDoc) => {
  const text = exports.deriveContentText(contentDoc, { preserveNewlines: false });
  if (!text) return 0;

  // Split by whitespace and filter empty strings
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  return words.length;
};

/**
 * Create a summary object with all derived data
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {Object} Summary object
 */
exports.processFull = (contentDoc) => {
  return {
    contentText: exports.deriveContentText(contentDoc),
    preview: exports.generatePreview(contentDoc),
    links: exports.extractLinks(contentDoc),
    codeBlocks: exports.extractCodeBlocks(contentDoc),
    wordCount: exports.countWords(contentDoc),
    hasLinks: exports.hasContentType(contentDoc, "link"),
    hasMentions: exports.hasContentType(contentDoc, "mention"),
    hasCodeBlocks: exports.hasContentType(contentDoc, "codeBlock"),
  };
};
