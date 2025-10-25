"use strict";

/**
 * TipTap Renderer Service
 * Converts TipTap JSON content to different formats for multi-channel delivery
 */

const { deriveContentText } = require("./chatContentProcessor");

/**
 * Convert TipTap JSON to plain text (reuses existing processor)
 * Used for: SMS, WhatsApp (fallback), plain text exports
 * @param {Object} contentDoc - TipTap JSON document
 * @param {Object} options - { maxLength?, preserveNewlines? }
 * @returns {String} Plain text
 */
exports.toPlainText = (contentDoc, options = {}) => {
  return deriveContentText(contentDoc, {
    preserveNewlines: true,
    ...options,
  });
};

/**
 * Convert TipTap JSON to HTML for email
 * Produces safe, simple HTML suitable for email clients
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {String} HTML string
 */
exports.toEmailHtml = (contentDoc) => {
  if (!contentDoc || typeof contentDoc !== "object") {
    return "";
  }

  const htmlParts = [];

  function traverse(node, inList = false) {
    if (!node || typeof node !== "object") return;

    // Handle text nodes with marks (bold, italic, etc.)
    if (node.type === "text" && node.text) {
      let text = escapeHtml(node.text);

      // Apply marks
      if (node.marks && Array.isArray(node.marks)) {
        node.marks.forEach((mark) => {
          switch (mark.type) {
            case "bold":
              text = `<strong>${text}</strong>`;
              break;
            case "italic":
              text = `<em>${text}</em>`;
              break;
            case "underline":
              text = `<u>${text}</u>`;
              break;
            case "strike":
              text = `<s>${text}</s>`;
              break;
            case "code":
              text = `<code>${text}</code>`;
              break;
            case "link":
              const href = escapeHtml(mark.attrs?.href || "#");
              text = `<a href="${href}" style="color: #0066cc; text-decoration: underline;">${text}</a>`;
              break;
          }
        });
      }

      htmlParts.push(text);
      return;
    }

    // Handle mentions
    if (node.type === "mention" && node.attrs) {
      const mentionText = `@${escapeHtml(node.attrs.label || node.attrs.id)}`;
      htmlParts.push(`<span style="color: #0066cc; font-weight: bold;">${mentionText}</span>`);
      return;
    }

    // Handle hard breaks
    if (node.type === "hardBreak") {
      htmlParts.push("<br>");
      return;
    }

    // Handle paragraphs
    if (node.type === "paragraph") {
      htmlParts.push("<p>");
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child) => traverse(child, inList));
      }
      htmlParts.push("</p>");
      return;
    }

    // Handle headings
    if (node.type === "heading" && node.attrs?.level) {
      const level = Math.min(Math.max(node.attrs.level, 1), 6);
      htmlParts.push(`<h${level}>`);
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child) => traverse(child, inList));
      }
      htmlParts.push(`</h${level}>`);
      return;
    }

    // Handle blockquotes
    if (node.type === "blockquote") {
      htmlParts.push('<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; margin-left: 0; color: #666;">');
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child) => traverse(child, inList));
      }
      htmlParts.push("</blockquote>");
      return;
    }

    // Handle code blocks
    if (node.type === "codeBlock") {
      htmlParts.push('<pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>');
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child) => traverse(child, inList));
      }
      htmlParts.push("</code></pre>");
      return;
    }

    // Handle bullet lists
    if (node.type === "bulletList") {
      htmlParts.push("<ul>");
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child) => traverse(child, true));
      }
      htmlParts.push("</ul>");
      return;
    }

    // Handle ordered lists
    if (node.type === "orderedList") {
      htmlParts.push("<ol>");
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child) => traverse(child, true));
      }
      htmlParts.push("</ol>");
      return;
    }

    // Handle list items
    if (node.type === "listItem") {
      htmlParts.push("<li>");
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child) => traverse(child, true));
      }
      htmlParts.push("</li>");
      return;
    }

    // Handle horizontal rule
    if (node.type === "horizontalRule") {
      htmlParts.push("<hr>");
      return;
    }

    // Default: process children for unknown node types
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child) => traverse(child, inList));
    }
  }

  traverse(contentDoc);

  return htmlParts.join("");
};

/**
 * Convert TipTap JSON to WhatsApp-friendly text
 * Plain text with links preserved and basic formatting
 * @param {Object} contentDoc - TipTap JSON document
 * @returns {String} WhatsApp text
 */
exports.toWhatsappText = (contentDoc) => {
  if (!contentDoc || typeof contentDoc !== "object") {
    return "";
  }

  const textParts = [];

  function traverse(node) {
    if (!node || typeof node !== "object") return;

    // Handle text nodes with WhatsApp formatting
    if (node.type === "text" && node.text) {
      let text = node.text;

      // Apply WhatsApp markdown-style formatting
      if (node.marks && Array.isArray(node.marks)) {
        node.marks.forEach((mark) => {
          switch (mark.type) {
            case "bold":
              text = `*${text}*`;
              break;
            case "italic":
              text = `_${text}_`;
              break;
            case "strike":
              text = `~${text}~`;
              break;
            case "code":
              text = `\`${text}\``;
              break;
            case "link":
              const href = mark.attrs?.href || "";
              text = `${text} (${href})`;
              break;
          }
        });
      }

      textParts.push(text);
      return;
    }

    // Handle mentions
    if (node.type === "mention" && node.attrs) {
      textParts.push(`@${node.attrs.label || node.attrs.id}`);
      return;
    }

    // Handle hard breaks
    if (node.type === "hardBreak") {
      textParts.push("\n");
      return;
    }

    // Handle block elements with newlines
    if (
      node.type === "paragraph" ||
      node.type === "blockquote" ||
      node.type === "codeBlock"
    ) {
      if (textParts.length > 0 && textParts[textParts.length - 1] !== "\n") {
        textParts.push("\n");
      }
    }

    // Add prefix for blockquotes
    if (node.type === "blockquote") {
      textParts.push("> ");
    }

    // Add prefix for code blocks
    if (node.type === "codeBlock") {
      textParts.push("```\n");
    }

    // Recursively process children
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child) => traverse(child));
    }

    // Add suffix for code blocks
    if (node.type === "codeBlock") {
      textParts.push("\n```");
    }

    // Add spacing after block elements
    if (
      node.type === "paragraph" ||
      node.type === "blockquote" ||
      node.type === "codeBlock"
    ) {
      if (textParts.length > 0 && textParts[textParts.length - 1] !== "\n") {
        textParts.push("\n");
      }
    }
  }

  traverse(contentDoc);

  // Clean up text
  let text = textParts.join("");
  text = text.replace(/\n{3,}/g, "\n\n"); // Max 2 consecutive newlines
  text = text.trim();

  return text;
};

/**
 * Convert TipTap JSON to SMS-friendly text
 * Concise plain text, strip unsupported formatting
 * @param {Object} contentDoc - TipTap JSON document
 * @param {Number} maxLength - Maximum SMS length (default 1600 for 10 SMS segments)
 * @returns {String} SMS text
 */
exports.toSmsText = (contentDoc, maxLength = 1600) => {
  // Get plain text
  let text = exports.toPlainText(contentDoc, {
    preserveNewlines: false, // SMS is usually single-line or minimal newlines
  });

  // Strip excessive whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Truncate if needed
  if (text.length > maxLength) {
    text = text.substring(0, maxLength - 3) + "...";
  }

  return text;
};

/**
 * Escape HTML special characters
 * @param {String} text - Text to escape
 * @returns {String} Escaped text
 */
function escapeHtml(text) {
  if (typeof text !== "string") return "";

  const htmlEntities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}
