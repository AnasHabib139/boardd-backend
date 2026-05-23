"use strict";

const { Router } = require("express");
const Auth       = require("../middlewares/Auth");
const { ROLES }  = require("../utils/constants");
const { validateConnectMonday, validateImportMonday } = require("../validation/mondayImportValidation");
const {
  getAuthUrl, connectMonday, getMondayBoards,
  disconnectMonday, importMondayBoards, getImportStatus,
} = require("../controller/mondayImportController");

class MondayImportApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    this.router.get("/auth-url",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getAuthUrl);
    this.router.post("/connect",             Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateConnectMonday, connectMonday);
    this.router.get("/boards",               Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getMondayBoards);
    this.router.post("/import",              Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateImportMonday, importMondayBoards);
    this.router.get("/import/status/:jobId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getImportStatus);
    this.router.delete("/disconnect",        Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), disconnectMonday);
  }

  getRouter()      { return this.router; }
  getRouterGroup() { return "/monday"; }
}

module.exports = MondayImportApi;
