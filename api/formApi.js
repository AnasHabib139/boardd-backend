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
  submitFormResponse,
} = require("../controller/formController");
const Auth = require("../middlewares/Auth");
const OptionalAuth = require("../middlewares/OptionalAuth");
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

    // Get forms by folder context (includes personalized isFav)
    router.get(
      "/folder",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateGetFolderFormsQuery,
      getFormsByFolder
    );

    // Get current user's favorites in folder context
    router.get(
      "/folder/favorites",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateGetFolderFormsQuery,
      require("../controller/formController").getFolderFavorites
    );

    // Share form from folder to channel
    router.post(
      "/:formId/share",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateFormId,
      validateShareForm,
      shareForm
    );

    // Toggle favorite for a form (personalized)
    router.post(
      "/:formId/favorite",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateFormId,
      require("../controller/formController").toggleFavoriteForm
    );

    // Get form by ID
    router.get(
      "/:formId",
      OptionalAuth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]), // Allow guest access for public forms
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

    // Share form (email/link) - like task sharing
    router.post(
      "/:formId/share",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateFormId,
      validateShareForm,
      shareForm
    );

    // Submit form response (public access - no auth required)
    router.post("/:formId/submit", submitFormResponse);
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/forms";
  }
}

module.exports = FormApi;
