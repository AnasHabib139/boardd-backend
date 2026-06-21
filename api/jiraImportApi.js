"use strict";

const { Router } = require("express");
const Auth       = require("../middlewares/Auth");
const { ROLES }  = require("../utils/constants");
const { validateConnectJira, validateSelectSite, validateImportJira } = require("../validation/jiraImportValidation");
const {
  getAuthUrl, connectJira, selectSite, getJiraProjects,
  importJiraProjects, getImportStatus, disconnectJira,
} = require("../controller/jiraImportController");

class JiraImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectJira, connectJira);
    this.router.post("/select-site",         Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateSelectSite, selectSite);
    this.router.get("/projects",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getJiraProjects);
    this.router.post("/import",              Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportJira, importJiraProjects);
    this.router.get("/import/status/:jobId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getImportStatus);
    this.router.delete("/disconnect",        Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectJira);
  }

  getRouter()      { return this.router; }
  getRouterGroup() { return "/jira"; }
}

module.exports = JiraImportApi;
