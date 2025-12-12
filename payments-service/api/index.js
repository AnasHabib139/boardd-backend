"use strict";

const { Router } = require("express");
const express = require("express");
const multer = require("multer");
const Auth = require("../../middlewares/Auth");
const { checkPermission } = require("../../middlewares/checkPermission");
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
  fixAccountEmailSettings,
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
  createInvoice,
  updateInvoice,
  finalizeInvoice,
  sendInvoice,
  voidInvoice,
  getInvoice,
  listInvoices,
  listAllInvoices,
  deleteInvoice,
  getTransactions,
} = require("../controllers/invoice.controller");

const {
  createSubscription,
  updateSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  listSubscriptions,
} = require("../controllers/subscription.controller");

const {
  enableIssuing,
  completeIssuingRequirements,
  createFinancialAccount,
  createCardholder,
  deleteCardholder,
  issueCard,
  getCardDetails,
  toggleCardFreeze,
  cancelCard,
  listTransactions,
  getMerchants,
  payout,
  fundCard,
  getBalance,
  getPayoutSettings,
  updatePayoutSettings,
  getAllTransactions,
  updateTransactionLabels,
  exportTransactions,
} = require("../controllers/issuing.controller");

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
  validateEnableIssuing,
  validateCompleteRequirements,
  validateCreateFinancialAccount,
  validateCreateCardholder,
  validateIssueCard,
  validateToggleCardFreeze,
  validateCancelCard,
  validateListTransactions,
  validatePayout,
  validateFundCard,
  validateGetBalance,
  validateGetPayoutSettings,
  validateUpdatePayoutSettings,
  validateGetAllTransactions,
  validateUpdateTransactionLabels,
} = require("../validation/issuing.validation");

const {
  validateBrandingFileUpload,
  validateUpdateBranding,
} = require("../validation/branding.validation");

const {
  validateCreateInvoice,
  validateUpdateInvoice,
  validateCreateSubscription,
  validateUpdateSubscription,
  validateCancelSubscription,
} = require("../validation/invoice.validation");

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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
      validateSetPersonsProvided,
      setPersonsProvided
    );

    /**
     * POST /api/payments/connect/accounts/:companyId/fix-email-settings
     * Fix email settings for connected account (required for invoice email delivery)
     * Auth: Admin
     * No body required
     */
    router.post(
      "/connect/accounts/:companyId/fix-email-settings",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      fixAccountEmailSettings
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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
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
      checkPermission("accessBilling"),
      removeBrandingAsset
    );

    // ==================== Issuing Routes ====================

    /**
     * POST /api/payments/issuing/enable
     * Enable card_issuing capability for connected account
     * Auth: Admin only
     * Returns: Capability status and requirements
     */
    router.post(
      "/issuing/enable",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateEnableIssuing,
      enableIssuing
    );

    /**
     * POST /api/payments/issuing/complete-requirements
     * Complete Issuing requirements to activate capability
     * Auth: Admin only
     * Body: { annualRevenue, estimatedWorkerCount, tosAcceptance }
     * Returns: Updated capability status
     */
    router.post(
      "/issuing/complete-requirements",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateCompleteRequirements,
      completeIssuingRequirements
    );

    /**
     * POST /api/payments/issuing/financial-account
     * Create Financial Account for company
     * Auth: Admin only
     * Returns: Financial Account details
     */
    router.post(
      "/issuing/financial-account",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateCreateFinancialAccount,
      createFinancialAccount
    );

    /**
     * POST /api/payments/issuing/cardholder
     * Create cardholder for company
     * Auth: Admin only
     * Body: { name, email, phoneNumber, taxId, billing }
     * Returns: Created cardholder details
     */
    router.post(
      "/issuing/cardholder",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateCreateCardholder,
      createCardholder
    );

    /**
     * DELETE /api/payments/issuing/cardholder
     * Delete cardholder and associated cards for company
     * Auth: Admin only
     * Returns: Confirmation message
     */
    router.delete(
      "/issuing/cardholder",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      deleteCardholder
    );

    /**
     * POST /api/payments/issuing/card
     * Issue virtual card for company
     * Auth: Admin only
     * Body: { currency } (optional, defaults to "usd")
     * Returns: Issued card details
     */
    router.post(
      "/issuing/card",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateIssueCard,
      issueCard
    );

    /**
     * GET /api/payments/issuing/card/details
     * Get sensitive card details (full number, CVC)
     * Auth: Admin only
     * Body: None
     * Returns: Full card number, CVC, expiry
     * SECURITY: Audit logged
     */
    router.get(
      "/issuing/card/details",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      getCardDetails
    );

    /**
     * POST /api/payments/issuing/card/toggle-freeze
     * Toggle card freeze status (active ↔ inactive)
     * Auth: Admin only
     * Body: None
     * Returns: New card status and freeze state
     */
    router.post(
      "/issuing/card/toggle-freeze",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateToggleCardFreeze,
      toggleCardFreeze
    );

    /**
     * POST /api/payments/issuing/cards/:cardId/cancel
     * Cancel an issued card (permanent action)
     * Auth: Admin only
     * Params: cardId
     * Returns: Canceled card details
     */
    router.post(
      "/issuing/cards/:cardId/cancel",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateCancelCard,
      cancelCard
    );

    /**
     * GET /api/payments/issuing/transactions
     * List transactions (purchase, refunds, deposit, send)
     * Auth: Admin only
     * Query params: type (purchase|refunds|deposit|send), limit (1-100), starting_after
     * Returns: Unified transaction list from Issuing + Treasury APIs
     */
    router.get(
      "/issuing/transactions",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateListTransactions,
      listTransactions
    );

    /**
     * GET /api/payments/issuing/merchants
     * Get list of available merchants for spending controls
     * Auth: None (public reference data)
     * Query: ?search=keyword (optional)
     * Returns: List of merchant codes and names
     */
    router.get(
      "/issuing/merchants",
      getMerchants
    );

    // ==================== Banking Routes ====================

    /**
     * POST /api/payments/banking/payout
     * Create payout from Connected Account to linked external bank
     * Auth: Admin only
     * Body: { amount, description?, method? }
     * Returns: Payout details with status and arrival date
     */
    router.post(
      "/banking/payout",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validatePayout,
      payout
    );

    /**
     * POST /api/payments/banking/fund-card
     * Fund card balance by transferring from Payments Balance to Issuing Balance
     * Auth: Admin only
     * Body: { amount, description? }
     * Returns: Balance transfer details
     */
    router.post(
      "/banking/fund-card",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateFundCard,
      fundCard
    );

    /**
     * GET /api/payments/banking/balance
     * Get account balances (Connected Account + Financial Account)
     * Auth: Admin only
     * Returns: Payments balance, issuing balance, financial account balance, totals
     */
    router.get(
      "/banking/balance",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateGetBalance,
      getBalance
    );

    /**
     * GET /api/payments/banking/payout-settings
     * Get payout schedule and instant eligibility
     * Auth: Admin only
     * Returns: Current schedule settings and instant payout eligibility
     */
    router.get(
      "/banking/payout-settings",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateGetPayoutSettings,
      getPayoutSettings
    );

    /**
     * PUT /api/payments/banking/payout-settings
     * Update payout schedule (manual/daily/weekly/monthly)
     * Auth: Admin only
     * Body: { interval, delay_days?, weekly_anchor? }
     * Returns: Updated schedule settings
     */
    router.put(
      "/banking/payout-settings",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateUpdatePayoutSettings,
      updatePayoutSettings
    );

    /**
     * GET /api/payments/banking/transactions
     * Get all company transactions (invoices + banking)
     * Auth: Admin only
     * Query: type?, status?, limit?, page?, startDate?, endDate?
     * Returns: Unified transaction list with pagination
     */
    router.get(
      "/banking/transactions",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateGetAllTransactions,
      getAllTransactions
    );

    /**
     * GET /api/payments/banking/transactions/export
     * Export all transactions as CSV
     * Auth: Admin only
     * Query: type?, status?, startDate?, endDate?, search?
     * Returns: CSV file download
     */
    router.get(
      "/banking/transactions/export",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      exportTransactions
    );

    /**
     * PUT /api/payments/banking/transactions/:id/labels
     * Update labels for a transaction
     * Auth: Admin only
     * Body: { labels: string[], source: 'invoice' | 'payout' | 'fund_card' }
     * Returns: Updated transaction labels
     */
    router.put(
      "/banking/transactions/:id/labels",
      Auth([ROLES.ADMIN]),
      checkPermission("accessBilling"),
      validateUpdateTransactionLabels,
      updateTransactionLabels
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
      checkPermission("accessClientPayments"),
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
      checkPermission("accessClientPayments"),
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
      checkPermission("accessClientPayments"),
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
      checkPermission("accessClientPayments"),
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
      checkPermission("accessClientPayments"),
      setDefaultPaymentMethod
    );

    // ==================== Invoice Routes ====================

    /**
     * POST /api/payments/clients/:tabId/invoices
     * Create one-time invoice
     * Auth: Admin or Employee
     * Body: { collectionMethod, dueDate, description, footer, currency, lineItems, autoSend }
     */
    router.post(
      "/clients/:tabId/invoices",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateInvoice,
      createInvoice
    );

    /**
     * PUT /api/payments/clients/:tabId/invoices/:invoiceId
     * Update draft invoice
     * Auth: Admin or Employee
     */
    router.put(
      "/clients/:tabId/invoices/:invoiceId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateUpdateInvoice,
      updateInvoice
    );

    /**
     * POST /api/payments/clients/:tabId/invoices/:invoiceId/finalize
     * Finalize invoice (draft → open)
     * Auth: Admin or Employee
     */
    router.post(
      "/clients/:tabId/invoices/:invoiceId/finalize",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      finalizeInvoice
    );

    /**
     * POST /api/payments/clients/:tabId/invoices/:invoiceId/send
     * Send invoice email to client
     * Auth: Admin or Employee
     */
    router.post(
      "/clients/:tabId/invoices/:invoiceId/send",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      sendInvoice
    );

    /**
     * POST /api/payments/clients/:tabId/invoices/:invoiceId/void
     * Void invoice
     * Auth: Admin or Employee
     */
    router.post(
      "/clients/:tabId/invoices/:invoiceId/void",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      voidInvoice
    );

    /**
     * GET /api/payments/clients/:tabId/invoices/:invoiceId
     * Get invoice details with line items
     * Auth: Admin or Employee
     */
    router.get(
      "/clients/:tabId/invoices/:invoiceId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getInvoice
    );

    /**
     * GET /api/payments/invoices
     * List all invoices for company (across all clients/tabs)
     * Query: ?status=draft|open|paid|void&limit=10&page=1&days=60
     * Auth: Admin or Employee
     */
    router.get(
      "/invoices",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      listAllInvoices
    );

    /**
     * GET /api/payments/clients/:tabId/invoices
     * List all invoices for client
     * Query: ?status=draft|open|paid|void&limit=10&page=1
     * Auth: Admin or Employee
     */
    router.get(
      "/clients/:tabId/invoices",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      listInvoices
    );

    /**
     * DELETE /api/payments/clients/:tabId/invoices/:invoiceId
     * Delete draft invoice
     * Auth: Admin or Employee
     */
    router.delete(
      "/clients/:tabId/invoices/:invoiceId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      deleteInvoice
    );

    /**
     * GET /api/payments/clients/:tabId/transactions
     * Get transactions (invoices where payment was attempted)
     * Query: ?status=paid|open|void|uncollectible&limit=10&page=1
     * Auth: Admin or Employee
     * Returns: Transaction history with payment details
     */
    router.get(
      "/clients/:tabId/transactions",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("accessClientPayments"),
      getTransactions
    );

    // ==================== Subscription Routes ====================

    /**
     * POST /api/payments/clients/:tabId/subscriptions
     * Create recurring subscription
     * Auth: Admin or Employee
     * Body: { amount, currency, interval, intervalCount, collectionMethod, endDate, endAfterCycles, description }
     */
    router.post(
      "/clients/:tabId/subscriptions",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateSubscription,
      createSubscription
    );

    /**
     * PUT /api/payments/clients/:tabId/subscriptions/:subscriptionId
     * Update subscription
     * Auth: Admin or Employee
     */
    router.put(
      "/clients/:tabId/subscriptions/:subscriptionId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateUpdateSubscription,
      updateSubscription
    );

    /**
     * POST /api/payments/clients/:tabId/subscriptions/:subscriptionId/cancel
     * Cancel subscription
     * Auth: Admin or Employee
     * Body: { cancelAtPeriodEnd }
     */
    router.post(
      "/clients/:tabId/subscriptions/:subscriptionId/cancel",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCancelSubscription,
      cancelSubscription
    );

    /**
     * POST /api/payments/clients/:tabId/subscriptions/:subscriptionId/pause
     * Pause subscription
     * Auth: Admin or Employee
     */
    router.post(
      "/clients/:tabId/subscriptions/:subscriptionId/pause",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      pauseSubscription
    );

    /**
     * POST /api/payments/clients/:tabId/subscriptions/:subscriptionId/resume
     * Resume paused subscription
     * Auth: Admin or Employee
     */
    router.post(
      "/clients/:tabId/subscriptions/:subscriptionId/resume",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      resumeSubscription
    );

    /**
     * GET /api/payments/clients/:tabId/subscriptions
     * List all subscriptions for client
     * Auth: Admin or Employee
     */
    router.get(
      "/clients/:tabId/subscriptions",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      listSubscriptions
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

    /**
     * POST /api/payments/webhook
     * Webhook route alias for Stripe CLI compatibility
     * Auth: Webhook signature verification
     * Body: Raw Stripe webhook payload
     */
    router.post(
      "/webhook",
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
