"use strict";

const { Router } = require("express");
const express = require("express");
const multer = require("multer");
const Auth = require("../../middlewares/Auth");
const { ROLES } = require("../../utils/constants");

const {
  createAccount,
  updateAccount,
  addPerson,
  updatePerson,
  uploadPersonDocument,
  getAccountStatus,
  getRequirementsList,
  addExternalAccount,
  handleWebhook,
  setPersonsProvided,
  getCountries,
} = require("../controllers/connect.controller");

const {
  createClientSetupIntent,
  savePaymentMethod,
  listClientPaymentMethods,
  removePaymentMethod,
  setDefaultPaymentMethod,
} = require("../controllers/clientPayment.controller");

const {
  uploadBrandingFile,
  updateBranding,
  getBranding,
  removeBrandingAsset,
} = require("../controllers/branding.controller");

const {
  validateCreateAccount,
  validateUpdateAccount,
  validateAddPerson,
  validateUpdatePerson,
  validateAddExternalAccount,
  validateGetAccountStatus,
  validateSetPersonsProvided,
} = require("../validation/connect.validation");

const {
  validateBrandingFileUpload,
  validateUpdateBranding,
} = require("../validation/branding.validation");

// Configure multer for file uploads (memory storage for Stripe Files API)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images and PDFs
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and PDF are allowed."));
    }
  },
});

/**
 * Payments Service API Routes
 * Handles Stripe Connect onboarding and account management
 */
class PaymentsAPI {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    const router = this.router;

    // ==================== Utility Routes ====================

    /**
     * GET /api/payments/countries
     * Get list of all Stripe-supported countries with specifications
     * Auth: None (public endpoint)
     * Returns: List of countries with currency, payment methods, etc.
     */
    router.get("/countries", getCountries);

    // ==================== Connect Account Routes ====================

    /**
     * POST /api/payments/connect/accounts
     * Create Stripe Custom Connect account
     * Auth: Admin only
     * Body: Business information, address, tax ID, etc.
     * Returns: Account ID and dynamic requirements from Stripe
     */
    router.post(
      "/connect/accounts",
      Auth([ROLES.ADMIN]),
      validateCreateAccount,
      createAccount
    );

    /**
     * PUT /api/payments/connect/accounts/:companyId
     * Update Stripe Connect account information
     * Auth: Admin (same company)
     * Body: Partial updates to business info
     */
    router.put(
      "/connect/accounts/:companyId",
      Auth([ROLES.ADMIN]),
      validateUpdateAccount,
      updateAccount
    );

    /**
     * GET /api/payments/connect/accounts/:companyId/status
     * Get account onboarding status and requirements
     * Auth: Admin or Employee (same company)
     */
    router.get(
      "/connect/accounts/:companyId/status",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getAccountStatus
    );

    /**
     * GET /api/payments/connect/accounts/:companyId/requirements
     * Get requirements list with human-readable labels
     * Query: ?status=active|completed
     * Auth: Admin or Employee (same company)
     */
    router.get(
      "/connect/accounts/:companyId/requirements",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getRequirementsList
    );

    // ==================== Person Routes ====================

    /**
     * POST /api/payments/connect/accounts/:companyId/persons
     * Add representative or beneficial owner
     * Auth: Admin (same company)
     * Body: Person details (name, DOB, address, relationship)
     */
    router.post(
      "/connect/accounts/:companyId/persons",
      Auth([ROLES.ADMIN]),
      validateAddPerson,
      addPerson
    );

    /**
     * PUT /api/payments/connect/accounts/:companyId/persons/:personId
     * Update existing representative or beneficial owner
     * Auth: Admin (same company)
     * Body: Person details to update (all fields optional)
     */
    router.put(
      "/connect/accounts/:companyId/persons/:personId",
      Auth([ROLES.ADMIN]),
      validateUpdatePerson,
      updatePerson
    );

    /**
     * POST /api/payments/connect/accounts/:companyId/persons/:personId/documents
     * Upload ID verification document
     * Auth: Admin (same company)
     * Body: Multipart form with file upload
     */
    router.post(
      "/connect/accounts/:companyId/persons/:personId/documents",
      Auth([ROLES.ADMIN]),
      upload.single("document"),
      uploadPersonDocument
    );

    /**
     * POST /api/payments/connect/accounts/:companyId/persons-provided
     * Set attestation that all persons of a type have been provided
     * Auth: Admin (same company)
     * Body: { directors_provided, executives_provided, owners_provided }
     */
    router.post(
      "/connect/accounts/:companyId/persons-provided",
      Auth([ROLES.ADMIN]),
      validateSetPersonsProvided,
      setPersonsProvided
    );

    // ==================== External Account Routes ====================

    /**
     * POST /api/payments/connect/accounts/:companyId/external-account
     * Add bank account for payouts
     * Auth: Admin (same company)
     * Body: Bank account details (routing number, account number)
     */
    router.post(
      "/connect/accounts/:companyId/external-account",
      Auth([ROLES.ADMIN]),
      validateAddExternalAccount,
      addExternalAccount
    );

    // ==================== Branding Routes ====================

    /**
     * POST /api/payments/connect/accounts/:companyId/branding/upload
     * Upload branding file (icon or logo)
     * Auth: Admin (same company)
     * Body: Multipart form with file and purpose
     */
    router.post(
      "/connect/accounts/:companyId/branding/upload",
      Auth([ROLES.ADMIN]),
      upload.single("file"),
      validateBrandingFileUpload,
      uploadBrandingFile
    );

    /**
     * PUT /api/payments/connect/accounts/:companyId/branding
     * Update branding settings (colors, icon, logo)
     * Auth: Admin (same company)
     * Body: { icon, logo, primary_color, secondary_color }
     */
    router.put(
      "/connect/accounts/:companyId/branding",
      Auth([ROLES.ADMIN]),
      validateUpdateBranding,
      updateBranding
    );

    /**
     * GET /api/payments/connect/accounts/:companyId/branding
     * Get current branding settings
     * Auth: Admin or Employee (same company)
     */
    router.get(
      "/connect/accounts/:companyId/branding",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getBranding
    );

    /**
     * DELETE /api/payments/connect/accounts/:companyId/branding/:type
     * Remove branding asset (icon or logo)
     * Auth: Admin (same company)
     * Params: type = 'icon' or 'logo'
     */
    router.delete(
      "/connect/accounts/:companyId/branding/:type",
      Auth([ROLES.ADMIN]),
      removeBrandingAsset
    );

    // ==================== Client Payment Routes ====================

    /**
     * POST /api/payments/clients/:tabId/payment/setup-intent
     * Create SetupIntent for collecting payment card from client
     * Auth: Admin or Employee (must be tab member)
     * Body: { name, email, phone } (optional, for creating customer if doesn't exist)
     * Returns: client_secret for Payment Element
     */
    router.post(
      "/clients/:tabId/payment/setup-intent",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      createClientSetupIntent
    );

    /**
     * POST /api/payments/clients/:tabId/payment/methods
     * Save payment method after successful SetupIntent
     * Auth: Admin or Employee (must be tab member)
     * Body: { setupIntentId }
     * Returns: Saved payment method details
     */
    router.post(
      "/clients/:tabId/payment/methods",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      savePaymentMethod
    );

    /**
     * GET /api/payments/clients/:tabId/payment/methods
     * List all payment methods for client
     * Auth: Admin or Employee (must be tab member)
     * Returns: Array of payment methods with default flag
     */
    router.get(
      "/clients/:tabId/payment/methods",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      listClientPaymentMethods
    );

    /**
     * DELETE /api/payments/clients/:tabId/payment/methods/:paymentMethodId
     * Remove payment method from client
     * Auth: Admin or Employee (must be tab member)
     * Returns: Confirmation of removal
     */
    router.delete(
      "/clients/:tabId/payment/methods/:paymentMethodId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      removePaymentMethod
    );

    /**
     * POST /api/payments/clients/:tabId/payment/methods/:paymentMethodId/set-default
     * Set payment method as default for client
     * Auth: Admin or Employee (must be tab member)
     * Returns: Confirmation of default change
     */
    router.post(
      "/clients/:tabId/payment/methods/:paymentMethodId/set-default",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      setDefaultPaymentMethod
    );

    // ==================== Webhook Routes ====================

    /**
     * POST /api/payments/webhooks/stripe
     * Receive Stripe webhook events
     * Auth: Webhook signature verification
     * Body: Raw Stripe webhook payload
     */
    router.post(
      "/webhooks/stripe",
      express.raw({ type: "application/json" }),
      handleWebhook
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/payments";
  }
}

module.exports = PaymentsAPI;
