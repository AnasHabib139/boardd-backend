"use strict";

const { Router } = require("express");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { validateConnectClickUp, validateImportClickUp } = require("../validation/clickupImportValidation");
const {
  getAuthUrl,
  connectClickUp,
  getClickUpSpaces,
  disconnectClickUp,
  importClickUpSpaces,
  getImportStatus,
} = require("../controller/clickupImportController");

class ClickUpImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectClickUp, connectClickUp);
    this.router.get("/spaces",        Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getClickUpSpaces);
    this.router.post("/import",       Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportClickUp, importClickUpSpaces);
    this.router.get("/import/status/:jobId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getImportStatus);
    this.router.delete("/disconnect", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectClickUp);
  }

  getRouter() { return this.router; }
  getRouterGroup() { return "/clickup"; }
}

module.exports = ClickUpImportApi;
