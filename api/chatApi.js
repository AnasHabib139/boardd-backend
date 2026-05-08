"use strict";

const { Router } = require("express");
const chatController = require("../controller/chat.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateUpdateTwilioNumber,
  validateConversationIdParam,
  validateMessageDatesQuery,
} = require("../validation/chatValidation");

class ChatApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Resolve conversation (find or create DM/Group DM)
    router.post(
      "/conversations/resolve",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      chatController.resolveConversation
    );

    // Get days that have messages for a given month (calendar dots)
    router.get(
      "/conversations/:conversationId/message-dates",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateConversationIdParam,
      validateMessageDatesQuery,
      chatController.getMessageDates
    );

    // Get messages for a conversation (with pagination)
    router.get(
      "/conversations/:conversationId/messages",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      chatController.getConversationMessages
    );

    // Get user's DM and Group DM conversations (like WhatsApp/Slack sidebar)
    router.get(
      "/conversations",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      chatController.getConversations
    );

    // Update Twilio "from" number for a client conversation
    router.patch(
      "/conversations/:conversationId/twilio-number",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateConversationIdParam,
      validateUpdateTwilioNumber,
      chatController.updateConversationTwilioNumber
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/chat";
  }
}

module.exports = ChatApi;
