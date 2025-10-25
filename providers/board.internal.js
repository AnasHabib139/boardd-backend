"use strict";

/**
 * Board Internal Provider for Client Chat
 * Handles internal board delivery (no external send, immediate 'sent' status)
 */

/**
 * Send message internally on board
 * This is a no-op provider since board messages are already saved to database
 * This just returns success immediately
 * @param {Object} params - Board delivery parameters
 * @param {String} params.messageId - Internal message ID
 * @returns {Promise<Object>} { success, status, sentAt }
 */
exports.sendBoard = async (params) => {
  const { messageId } = params;

  try {
    // Board delivery is always successful (message already saved to DB)
    // Participants will receive it via socket broadcast

    console.log(`Board delivery successful for message ${messageId}`);

    return {
      success: true,
      providerMessageId: messageId, // Use internal message ID
      provider: "internal",
      status: "sent",
      sentAt: new Date(),
    };
  } catch (error) {
    // Board delivery should never fail since it's internal
    console.error("Board internal delivery unexpected error:", error);

    return {
      success: false,
      status: "failed",
      error: error.message || "Internal board delivery error",
    };
  }
};
