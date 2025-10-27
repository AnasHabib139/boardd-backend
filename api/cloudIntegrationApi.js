"use strict";

const { Router } = require("express");
const {
  initiateGoogleDriveAuth,
  googleDriveCallback,
  initiateDropboxAuth,
  dropboxCallback,
  getConnectedServices,
  disconnectService,
  browseGoogleDriveFiles,
  browseDropboxFiles,
  getFileMetadata,
} = require("../controller/cloudIntegration.controller");
const { ROLES } = require("../utils/constants");
const Auth = require("../middlewares/Auth");
const {
  validateBrowseFiles,
  validateFileMetadata,
} = require("../validation/cloudIntegrationValidation");

class CloudIntegrationAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Get all connected services for the user
    router.get(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      getConnectedServices
    );

    // Google Drive OAuth routes
    router.get(
      "/google-drive/auth",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      initiateGoogleDriveAuth
    );

    router.get("/google-drive/callback", googleDriveCallback);

    // Dropbox OAuth routes
    router.get(
      "/dropbox/auth",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      initiateDropboxAuth
    );

    router.get("/dropbox/callback", dropboxCallback);

    // Disconnect service
    router.post(
      "/:integrationId/disconnect",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      disconnectService
    );

    // Browse files in cloud storage
    router.get(
      "/google-drive/browse",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateBrowseFiles,
      browseGoogleDriveFiles
    );

    router.get(
      "/dropbox/browse",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateBrowseFiles,
      browseDropboxFiles
    );

    // Get file metadata from cloud storage
    router.get(
      "/file-metadata",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateFileMetadata,
      getFileMetadata
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/cloud-integrations";
  }
}

module.exports = CloudIntegrationAPI;
