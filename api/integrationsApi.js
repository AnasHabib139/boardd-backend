"use strict";

const { Router } = require("express");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { getIntegrationsStatus } = require("../controller/integrationsController");

class IntegrationsApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/status", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getIntegrationsStatus);
  }

  getRouter() { return this.router; }
  getRouterGroup() { return "/integrations"; }
}

module.exports = IntegrationsApi;
