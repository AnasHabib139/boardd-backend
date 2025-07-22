"use strict";

const { Router } = require("express");
const {
  createForm,
  getFormsByTab,
  getFormById,
  updateForm,
  deleteForm,
  downloadForm,
  shareForm,
  getFormsByFolder,
} = require("../controller/formController");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateForm,
  validateUpdateForm,
  validateGetFormsQuery,
  validateFormId,
  validateTabId,
  validateShareForm,
  validateGetFolderFormsQuery,
} = require("../validation/formValidation");

class FormApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Create form
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateForm,
      createForm
    );

    // Get forms by tab
    router.get(
      "/tab/:tabId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTabId,
      validateGetFormsQuery,
      getFormsByTab
    );

    // Get forms by folder context
    router.get(
      "/folder",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateGetFolderFormsQuery,
      getFormsByFolder
    );

    // Share form from folder to channel
    router.post(
      "/:formId/share",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateFormId,
      validateShareForm,
      shareForm
    );

    // Get form by ID
    router.get(
      "/:formId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]), // Allow guest access for public forms
      validateFormId,
      getFormById
    );

    // Update form
    router.put(
      "/:formId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateFormId,
      validateUpdateForm,
      updateForm
    );

    // Download form as DOCX
    router.get(
      "/:formId/download",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]), // Allow guest access for public forms
      validateFormId,
      downloadForm
    );

    // Delete form (soft delete)
    router.delete(
      "/:formId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateFormId,
      deleteForm
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/forms";
  }
}

module.exports = FormApi;
