"use strict";

const { Router } = require("express");
const {
  createOrUpdateClient,
  getClientForTab,
  updateClientData,
  deleteClientData,
} = require("../controller/client.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateOrUpdateClient,
  validateUpdateClientData,
  validateDeleteClientData,
} = require("../validation/clientValidation");

class ClientApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Create or update client with validation
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateOrUpdateClient,
      createOrUpdateClient
    );

    // Update specific client data (personal details or projects)
    router.put(
      "/:tabId/update",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateUpdateClientData,
      updateClientData
    );

    // Delete specific client data (personal details, projects, or attachments)
    router.delete(
      "/:tabId/delete",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateDeleteClientData,
      deleteClientData
    );

    // Get client for tab
    router.get("/:tabId", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), getClientForTab);
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/clients";
  }
}

module.exports = ClientApi;
