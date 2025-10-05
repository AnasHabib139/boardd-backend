"use strict";

const { Router } = require("express");
const chatController = require("../controller/chat.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");

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

    // Get messages for a conversation (with pagination)
    router.get(
      "/conversations/:conversationId/messages",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      chatController.getConversationMessages
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
