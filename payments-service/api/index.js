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
} = require("../controllers/connect.controller");

const {
  validateCreateAccount,
  validateUpdateAccount,
  validateAddPerson,
  validateUpdatePerson,
  validateAddExternalAccount,
  validateGetAccountStatus,
} = require("../validation/connect.validation");

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
