"use strict";

const { Router } = require("express");
const Auth       = require("../middlewares/Auth");
const { ROLES }  = require("../utils/constants");
const { validateConnectAsana, validateImportAsana } = require("../validation/asanaImportValidation");
const {
  getAuthUrl,
  connectAsana,
  getAsanaProjects,
  disconnectAsana,
  importAsanaProjects,
  getImportStatus,
} = require("../controller/asanaImportController");

class AsanaImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectAsana, connectAsana);
    this.router.get("/projects",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAsanaProjects);
    this.router.post("/import",              Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportAsana, importAsanaProjects);
    this.router.get("/import/status/:jobId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getImportStatus);
    this.router.delete("/disconnect",        Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectAsana);
  }

  getRouter()      { return this.router; }
  getRouterGroup() { return "/asana"; }
}

module.exports = AsanaImportApi;
