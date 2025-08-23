"use strict";

const { Router } = require("express");
const {
  uploadMultipleFiles,
  deleteFiles,
} = require("../controller/upload.controller");
const { upload } = require("../utils/s3Upload");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");

class UploadApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // // Single file upload route
    // router.post(
    //   "/single",
    //   Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
    //   uploadFiles.single("file"),
    //   uploadSingleFile
    // );

    // Multiple files upload route
    router.post(
      "/files",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      upload.array("files", 10), // Max 10 files
      uploadMultipleFiles
    );

    // Delete files route (handles both single and multiple files)
    router.delete("/files", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), deleteFiles);
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/upload";
  }
}

module.exports = UploadApi;
