"use strict";

const { Router } = require("express");
const Auth       = require("../middlewares/Auth");
const { ROLES }  = require("../utils/constants");
const { validateConnectLinear, validateImportLinear } = require("../validation/linearImportValidation");
const {
  getAuthUrl, connectLinear, getLinearTeams,
  importLinearTeams, getImportStatus, disconnectLinear,
} = require("../controller/linearImportController");

class LinearImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectLinear, connectLinear);
    this.router.get("/teams",               Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getLinearTeams);
    this.router.post("/import",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportLinear, importLinearTeams);
    this.router.get("/import/status/:jobId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getImportStatus);
    this.router.delete("/disconnect",       Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectLinear);
  }

  getRouter()      { return this.router; }
  getRouterGroup() { return "/linear"; }
}

module.exports = LinearImportApi;
