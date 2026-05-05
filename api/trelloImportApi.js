"use strict";

const { Router } = require("express");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { validateConnectTrello, validateImportBoard } = require("../validation/trelloImportValidation");
const {
  getAuthUrl,
  connectTrello,
  getTrelloBoards,
  disconnectTrello,
  importTrelloBoard,
} = require("../controller/trelloImportController");

class TrelloImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",    Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",    Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectTrello, connectTrello);
    this.router.get("/boards",      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getTrelloBoards);
    this.router.post("/import",     Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportBoard, importTrelloBoard);
    this.router.delete("/disconnect", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectTrello);
  }

  getRouter() { return this.router; }
  getRouterGroup() { return "/trello"; }
}

module.exports = TrelloImportApi;
