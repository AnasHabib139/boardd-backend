"use strict";

const { Router } = require("express");
const Auth       = require("../middlewares/Auth");
const { ROLES }  = require("../utils/constants");
const { validateConnectGithub, validateImportGithub } = require("../validation/githubImportValidation");
const {
  getAuthUrl, connectGithub, getGithubRepos, getGithubProjects,
  importGithubRepos, getImportStatus, disconnectGithub,
} = require("../controller/githubImportController");

class GithubImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectGithub, connectGithub);
    this.router.get("/repos",                Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getGithubRepos);
    this.router.get("/projects",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getGithubProjects);
    this.router.post("/import",              Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportGithub, importGithubRepos);
    this.router.get("/import/status/:jobId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getImportStatus);
    this.router.delete("/disconnect",        Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectGithub);
  }

  getRouter()      { return this.router; }
  getRouterGroup() { return "/github"; }
}

module.exports = GithubImportApi;
