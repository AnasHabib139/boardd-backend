"use strict";

const { Router } = require("express");
const Auth       = require("../middlewares/Auth");
const { ROLES }  = require("../utils/constants");
const { validateConnectNotion, validateImportNotion } = require("../validation/notionImportValidation");
const {
  getAuthUrl, connectNotion, getNotionItems,
  importNotion, getImportStatus, disconnectNotion,
} = require("../controller/notionImportController");

class NotionImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectNotion, connectNotion);
    this.router.get("/items",                Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getNotionItems);
    this.router.post("/import",              Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportNotion, importNotion);
    this.router.get("/import/status/:jobId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getImportStatus);
    this.router.delete("/disconnect",        Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectNotion);
  }

  getRouter()      { return this.router; }
  getRouterGroup() { return "/notion"; }
}

module.exports = NotionImportApi;
