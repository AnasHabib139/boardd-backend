/**
 * Stripe Issuing Transaction Simulator
 *
 * This script simulates all 4 transaction types for testing the transactions listing API:
 * 1. Purchase (card authorization)
 * 2. Refund (refund of purchase)
 * 3. Deposit (incoming wire transfer)
 * 4. Send (outgoing ACH debit)
 *
 * Usage: node payments-service/scripts/simulate-transactions.js
 */

const Stripe = require("stripe");

// ==================== CONFIGURATION ====================
// Update these values with your test data
const CONFIG = {
  stripeSecretKey:
    process.env.STRIPE_SECRET_KEY,
  connectedAccountId: "acct_1SWLSVRg4n3bbRuZ",
  issuedCardId: "ic_1SWMVsRg4n3bbRuZ0bSZvE5F",
  financialAccountId: "fa_1SWLkHRg4n3bbRuZERiR2ElN",

  // Card spending controls (must match card configuration)
  // Update these to match your card's actual spending controls
  cardSpendingControls: {
    allowedMerchants: ["accounting_bookkeeping_services"],
    spendingLimit: {
      amount: 50000, // $500.00 in cents
      interval: "monthly",
    },
  },
};

// Initialize Stripe
const stripe = new Stripe(CONFIG.stripeSecretKey);

// Results storage
const results = {
  purchase: null,
  refund: null,
  deposit: null,
  send: null,
  paymentMethod: null,
};

// ==================== HELPER FUNCTIONS ====================

function log(message, type = "info") {
  const colors = {
    info: "\x1b[36m", // Cyan
    success: "\x1b[32m", // Green
    error: "\x1b[31m", // Red
    warning: "\x1b[33m", // Yellow
    reset: "\x1b[0m",
  };

  const prefix = {
    info: "ℹ",
    success: "✓",
    error: "✗",
    warning: "⚠",
  };

  console.log(`${colors[type]}${prefix[type]} ${message}${colors.reset}`);
}

function section(title) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60) + "\n");
}

// ==================== SETUP FUNCTIONS ====================

async function ensureFinancialAccountFeatures() {
  section("Checking Financial Account Features");

  try {
    // Check current features
    const features = await stripe.treasury.financialAccounts.retrieveFeatures(
      CONFIG.financialAccountId,
      { stripeAccount: CONFIG.connectedAccountId }
    );

    log("Current features retrieved");

    // Enable ABA if needed
    if (
      !features.financial_addresses?.aba ||
      features.financial_addresses.aba.status !== "active"
    ) {
      log("Enabling financial_addresses.aba feature...", "warning");
      await stripe.treasury.financialAccounts.updateFeatures(
        CONFIG.financialAccountId,
        {
          financial_addresses: {
            aba: { requested: true },
          },
        },
        { stripeAccount: CONFIG.connectedAccountId }
      );
      log("ABA feature enabled", "success");
    } else {
      log("ABA feature already active", "success");
    }

    // Enable outbound transfers if needed
    if (
      !features.outbound_transfers?.ach ||
      features.outbound_transfers.ach.status !== "active"
    ) {
      log("Enabling outbound_transfers.ach feature...", "warning");
      await stripe.treasury.financialAccounts.updateFeatures(
        CONFIG.financialAccountId,
        {
          outbound_transfers: {
            ach: { requested: true },
          },
        },
        { stripeAccount: CONFIG.connectedAccountId }
      );
      log("Outbound transfers feature enabled", "success");
    } else {
      log("Outbound transfers already active", "success");
    }
  } catch (error) {
    log(`Error setting up features: ${error.message}`, "error");
    throw error;
  }
}

// ==================== TRANSACTION SIMULATORS ====================

async function createPaymentMethod() {
  section("Step 1: Creating Payment Method");

  try {
    const paymentMethod = await stripe.paymentMethods.create(
      {
        type: "us_bank_account",
        us_bank_account: {
          account_holder_type: "individual",
          account_number: "000123456789",
          routing_number: "110000000",
        },
        billing_details: {
          name: "Test User",
        },
      },
      { stripeAccount: CONFIG.connectedAccountId }
    );

    results.paymentMethod = paymentMethod.id;
    log(`PaymentMethod created: ${paymentMethod.id}`, "success");
    return paymentMethod.id;
  } catch (error) {
    log(`Error creating payment method: ${error.message}`, "error");
    throw error;
  }
}

async function simulatePurchase(paymentMethodId) {
  section("Step 3: Simulating Purchase Transaction");

  try {
    // Create a test purchase authorization
    // Using allowed merchant category from CONFIG.cardSpendingControls
    const authorization =
      await stripe.testHelpers.issuing.authorizations.create(
        {
          amount: 5000, // $50.00 (under the $500 spending limit)
          currency: "usd",
          card: CONFIG.issuedCardId,
          merchant_data: {
            category: CONFIG.cardSpendingControls.allowedMerchants[0], // Use allowed category
            city: "San Francisco",
            country: "US",
            name: "QuickBooks Accounting",
            network_id: "1234567890",
            postal_code: "94107",
          },
        },
        { stripeAccount: CONFIG.connectedAccountId }
      );

    log(`Authorization created: ${authorization.id}`, "success");
    log(`  Status: ${authorization.status}`, "info");
    log(`  Approved: ${authorization.approved}`, "info");

    // Check if authorization was declined
    if (!authorization.approved || authorization.status !== "pending") {
      log(`Authorization was declined!`, "error");
      if (authorization.request_history && authorization.request_history.length > 0) {
        const lastRequest = authorization.request_history[authorization.request_history.length - 1];
        log(`  Decline reason: ${lastRequest.reason}`, "error");
        log(`  Amount: ${lastRequest.amount}`, "info");
        log(`  Merchant category: ${lastRequest.merchant_category}`, "info");
      }
      throw new Error(`Authorization declined: ${authorization.status} - Check card spending controls or status`);
    }

    // Capture the authorization to create a transaction
    const captured = await stripe.testHelpers.issuing.authorizations.capture(
      authorization.id,
      { stripeAccount: CONFIG.connectedAccountId }
    );

    // Get the transaction
    const transactions = await stripe.issuing.transactions.list(
      { card: CONFIG.issuedCardId, limit: 1 },
      { stripeAccount: CONFIG.connectedAccountId }
    );

    const transaction = transactions.data[0];
    results.purchase = transaction.id;

    log(`Purchase transaction created: ${transaction.id}`, "success");
    log(`  Amount: $${(transaction.amount / 100).toFixed(2)}`, "info");
    log(`  Merchant: ${transaction.merchant_data?.name || "Unknown"}`, "info");

    return transaction.id;
  } catch (error) {
    log(`Error creating purchase: ${error.message}`, "error");
    throw error;
  }
}

async function simulateRefund(purchaseTransactionId) {
  section("Step 4: Simulating Refund Transaction");

  try {
    // Create a test refund
    const refund =
      await stripe.testHelpers.issuing.transactions.createForceCapture(
        {
          amount: 5000, // Full refund of $50.00
          currency: "usd",
          card: CONFIG.issuedCardId,
          purchase_details: {
            reference: purchaseTransactionId,
          },
        },
        { stripeAccount: CONFIG.connectedAccountId }
      );

    // Refund it
    const refunded = await stripe.testHelpers.issuing.transactions.refund(
      refund.id,
      { stripeAccount: CONFIG.connectedAccountId }
    );

    results.refund = refunded.id;

    log(`Refund transaction created: ${refunded.id}`, "success");
    log(`  Amount: $${(refunded.amount / 100).toFixed(2)}`, "info");

    return refunded.id;
  } catch (error) {
    log(`Error creating refund: ${error.message}`, "error");
    throw error;
  }
}

async function simulateDeposit() {
  section("Step 2: Funding Account (Deposit)");

  try {
    // Create a received credit (incoming wire transfer)
    const receivedCredit =
      await stripe.testHelpers.treasury.receivedCredits.create(
        {
          financial_account: CONFIG.financialAccountId,
          amount: 50000, // $500.00
          currency: "usd",
          network: "us_domestic_wire",
          description: "Test deposit",
        },
        { stripeAccount: CONFIG.connectedAccountId }
      );

    results.deposit = receivedCredit.id;

    log(`Deposit transaction created: ${receivedCredit.id}`, "success");
    log(`  Amount: +$${(receivedCredit.amount / 100).toFixed(2)}`, "info");
    log(`  Network: ${receivedCredit.network}`, "info");
    log(`  Status: ${receivedCredit.status}`, "info");

    return receivedCredit.id;
  } catch (error) {
    log(`Error creating deposit: ${error.message}`, "error");
    throw error;
  }
}

async function simulateSend() {
  section("Step 5: Simulating Send Transaction");

  try {
    // Create a received debit (outgoing ACH debit)
    const receivedDebit =
      await stripe.testHelpers.treasury.receivedDebits.create(
        {
          financial_account: CONFIG.financialAccountId,
          amount: 10000, // $100.00
          currency: "usd",
          network: "ach",
          description: "Test send",
        },
        { stripeAccount: CONFIG.connectedAccountId }
      );

    results.send = receivedDebit.id;

    log(`Send transaction created: ${receivedDebit.id}`, "success");
    log(`  Amount: -$${(receivedDebit.amount / 100).toFixed(2)}`, "info");
    log(`  Network: ${receivedDebit.network}`, "info");
    log(`  Status: ${receivedDebit.status}`, "info");

    return receivedDebit.id;
  } catch (error) {
    log(`Error creating send: ${error.message}`, "error");
    throw error;
  }
}

// ==================== SUMMARY ====================

function printSummary() {
  section("Simulation Complete - Summary");

  console.log("┌─────────────────────┬──────────────────────────────────────┐");
  console.log("│ Transaction Type    │ ID                                   │");
  console.log("├─────────────────────┼──────────────────────────────────────┤");
  console.log(
    `│ PaymentMethod       │ ${results.paymentMethod || "Failed".padEnd(36)} │`
  );
  console.log(
    `│ Purchase (capture)  │ ${results.purchase || "Failed".padEnd(36)} │`
  );
  console.log(
    `│ Refund              │ ${results.refund || "Failed".padEnd(36)} │`
  );
  console.log(
    `│ Deposit (credit)    │ ${results.deposit || "Failed".padEnd(36)} │`
  );
  console.log(
    `│ Send (debit)        │ ${results.send || "Failed".padEnd(36)} │`
  );
  console.log("└─────────────────────┴──────────────────────────────────────┘");

  console.log("\n" + "=".repeat(60));
  log("You can now test the transactions API endpoint:", "success");
  console.log("\n  GET /api/payments/issuing/transactions");
  console.log("  GET /api/payments/issuing/transactions?type=purchase");
  console.log("  GET /api/payments/issuing/transactions?type=refunds");
  console.log("  GET /api/payments/issuing/transactions?type=deposit");
  console.log("  GET /api/payments/issuing/transactions?type=send\n");
  console.log("=".repeat(60) + "\n");
}

// ==================== MAIN EXECUTION ====================

async function main() {
  console.log("\n");
  log("🚀 Stripe Issuing Transaction Simulator", "info");
  log("This will create test transactions for all 4 types", "info");

  try {
    // Step 0: Ensure features are enabled
    await ensureFinancialAccountFeatures();

    // Step 1: Create PaymentMethod
    const paymentMethodId = await createPaymentMethod();

    // Step 2: Fund the account first (deposit before spending)
    await simulateDeposit();

    // Step 3: Simulate Purchase (now account has funds)
    const purchaseId = await simulatePurchase(paymentMethodId);

    // Step 4: Simulate Refund
    await simulateRefund(purchaseId);

    // Step 5: Simulate Send
    await simulateSend();

    // Print summary
    printSummary();
  } catch (error) {
    console.log("\n");
    log("Simulation failed!", "error");
    log(error.message, "error");
    if (error.stack) {
      console.log(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
