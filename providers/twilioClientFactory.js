"use strict";

/**
 * Twilio Client Factory
 * Provides company-specific Twilio clients with caching
 * Supports multi-tenant architecture with fallback to legacy master account
 */

const twilio = require("twilio");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");

// In-memory cache with TTL (30 minutes)
const clientCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Get Twilio client for a specific company
 * @param {String|ObjectId} companyId - Company ID
 * @returns {Promise<TwilioClient>} Authenticated Twilio client
 */
async function getTwilioClientForCompany(companyId) {
  try {
    const companyIdStr = companyId.toString();

    // Check cache first
    const cached = clientCache.get(companyIdStr);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`Using cached Twilio client for company ${companyIdStr}`);
      return cached.client;
    }

    // Fetch company config (include encrypted fields)
    const company = await Company.findById(companyId).select(
      "+twilioConfig.apiKeySecret +twilioConfig.authToken"
    );

    if (!company) {
      console.warn(`Company ${companyIdStr} not found, using legacy client`);
      return getLegacyTwilioClient();
    }

    // Check if company should use subaccount
    if (
      !company.twilioConfig ||
      !company.twilioConfig.useTwilioSubaccount ||
      !company.twilioConfig.subAccountSid
    ) {
      console.log(
        `Company ${companyIdStr} not configured for multi-tenant Twilio, using legacy client`
      );
      return getLegacyTwilioClient();
    }

    // Create subaccount client (prefer API Key over Auth Token)
    let client;

    if (
      company.twilioConfig.apiKeySid &&
      company.twilioConfig.apiKeySecret
    ) {
      // Use API Key (recommended)
      console.log(
        `Creating Twilio client for company ${companyIdStr} using API Key`
      );
      client = twilio(
        company.twilioConfig.apiKeySid,
        company.twilioConfig.apiKeySecret,
        { accountSid: company.twilioConfig.subAccountSid }
      );
    } else if (company.twilioConfig.authToken) {
      // Fallback to Auth Token
      console.log(
        `Creating Twilio client for company ${companyIdStr} using Auth Token`
      );
      client = twilio(
        company.twilioConfig.subAccountSid,
        company.twilioConfig.authToken
      );
    } else {
      throw new Error(
        `Company ${companyIdStr} Twilio config incomplete (missing credentials)`
      );
    }

    // Cache the client
    clientCache.set(companyIdStr, {
      client,
      timestamp: Date.now(),
    });

    console.log(
      `Twilio client created and cached for company ${companyIdStr}`
    );
    return client;
  } catch (error) {
    console.error(
      `Error getting Twilio client for company ${companyId}:`,
      error.message
    );
    console.log("Falling back to legacy Twilio client");
    return getLegacyTwilioClient();
  }
}

/**
 * Get legacy Twilio client (master account)
 * Used for companies not yet migrated to multi-tenant
 * @returns {TwilioClient} Legacy Twilio client
 */
function getLegacyTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error(
      "Legacy Twilio credentials not configured in environment variables"
    );
  }

  return twilio(accountSid, authToken);
}

/**
 * Get Twilio master account client (for provisioning subaccounts)
 * @returns {TwilioClient} Master account client
 */
function getTwilioMasterClient() {
  const masterAccountSid =
    process.env.TWILIO_MASTER_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
  const masterAuthToken =
    process.env.TWILIO_MASTER_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;

  if (!masterAccountSid || !masterAuthToken) {
    throw new Error(
      "Twilio master account credentials not configured in environment variables"
    );
  }

  return twilio(masterAccountSid, masterAuthToken);
}

/**
 * Clear expired cache entries
 * Should be called periodically (e.g., via cron job)
 */
function clearExpiredCache() {
  const now = Date.now();
  let clearedCount = 0;

  for (const [key, value] of clientCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      clientCache.delete(key);
      clearedCount++;
    }
  }

  if (clearedCount > 0) {
    console.log(
      `Cleared ${clearedCount} expired Twilio client(s) from cache`
    );
  }

  return clearedCount;
}

/**
 * Clear cache for a specific company
 * Useful when company config changes
 * @param {String|ObjectId} companyId - Company ID
 */
function clearCacheForCompany(companyId) {
  const companyIdStr = companyId.toString();
  const deleted = clientCache.delete(companyIdStr);

  if (deleted) {
    console.log(`Cleared Twilio client cache for company ${companyIdStr}`);
  }

  return deleted;
}

/**
 * Clear all cached clients
 * Useful for testing or after configuration changes
 */
function clearAllCache() {
  const size = clientCache.size;
  clientCache.clear();
  console.log(`Cleared all ${size} Twilio client(s) from cache`);
  return size;
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
function getCacheStats() {
  return {
    size: clientCache.size,
    ttl: CACHE_TTL,
    entries: Array.from(clientCache.keys()),
  };
}

module.exports = {
  getTwilioClientForCompany,
  getLegacyTwilioClient,
  getTwilioMasterClient,
  clearExpiredCache,
  clearCacheForCompany,
  clearAllCache,
  getCacheStats,
};
