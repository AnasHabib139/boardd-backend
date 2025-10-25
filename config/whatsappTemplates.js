"use strict";

/**
 * WhatsApp Template Configuration
 *
 * Hardcoded WhatsApp Business templates for use with Twilio Content API.
 * These templates must be pre-approved by WhatsApp/Twilio before use.
 *
 * How to add new templates:
 * 1. Create template in Twilio Console (Content & Templates)
 * 2. Submit for WhatsApp approval (can take 24-48 hours)
 * 3. Once approved, copy the Content SID from Twilio
 * 4. Add template config here with name, language, contentSid, and parameters
 *
 * Template Approval Process:
 * - Go to Twilio Console > Messaging > Content Templates
 * - Create new template with variables like {{1}}, {{2}}, etc.
 * - Submit for WhatsApp approval
 * - Once approved, you'll get a Content SID (starts with "HX...")
 *
 * Usage:
 * Templates are used when sending WhatsApp messages OUTSIDE the 24-hour customer care window.
 * Within 24 hours of last client message, you can send free-form text without templates.
 */

module.exports = {
  templates: [
    // Board Template Message (APPROVED)
    // Template body: "hi {{1}} , update from us , get in touch so we can send you the complete list of updates asap"
    {
      name: "board_template_message",
      languageCode: "en",
      contentSid: "HX3b4de6fad8e792facbd45c71bf081a2a",
      description: "Update notification template for clients",
      parameters: [
        {
          index: 1,
          description: "Client name",
          example: "anas",
        },
      ],
    },
  ],

  /**
   * Get template by name and language
   * @param {String} name - Template name
   * @param {String} languageCode - Language code (default: 'en')
   * @returns {Object|null} Template config or null
   */
  getTemplate(name, languageCode = "en") {
    return (
      this.templates.find(
        (t) => t.name === name && t.languageCode === languageCode
      ) || null
    );
  },

  /**
   * Get all templates for a language
   * @param {String} languageCode - Language code
   * @returns {Array} Array of templates
   */
  getTemplatesByLanguage(languageCode) {
    return this.templates.filter((t) => t.languageCode === languageCode);
  },

  /**
   * Validate that a template exists
   * @param {String} name - Template name
   * @param {String} languageCode - Language code
   * @returns {Boolean} True if template exists and has contentSid
   */
  isTemplateAvailable(name, languageCode = "en") {
    const template = this.getTemplate(name, languageCode);
    return (
      template && template.contentSid && !template.contentSid.startsWith("HXx")
    );
  },
};
