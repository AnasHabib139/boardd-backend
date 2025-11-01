"use strict";

/**
 * Meta Embedded Signup Service
 * Handles WhatsApp Business Account (WABA) registration via Meta OAuth
 *
 * Provides automated WhatsApp sender registration without requiring
 * companies to access Twilio Console manually
 */

const axios = require("axios");
const crypto = require("crypto");
const { getRedis } = require("../utils/redis");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");

// Meta Graph API configuration
const META_GRAPH_API_BASE = `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || "v18.0"}`;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_OAUTH_REDIRECT_URI;
const META_OAUTH_SCOPES = process.env.META_OAUTH_SCOPES || "whatsapp_business_management,whatsapp_business_messaging,business_management";

/**
 * Generate Meta OAuth URL for Embedded Signup
 * @param {String} companyId - Company ID
 * @param {String} businessName - Business name for display
 * @param {String} phoneNumber - Optional phone number to pre-select
 * @returns {Promise<Object>} { authUrl, state }
 */
exports.generateOAuthUrl = async (companyId, businessName, phoneNumber = null) => {
  try {
    // Generate secure state token
    const stateData = {
      companyId,
      businessName,
      phoneNumber,
      nonce: crypto.randomBytes(16).toString("hex"),
      timestamp: Date.now()
    };

    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

    // Store state in Redis with 10-minute expiry
    const redis = getRedis();
    if (redis) {
      await redis.setex(`whatsapp_oauth_state:${companyId}`, 600, state);
    }

    // Build OAuth URL
    const params = new URLSearchParams({
      client_id: META_APP_ID,
      redirect_uri: META_REDIRECT_URI,
      scope: META_OAUTH_SCOPES,
      response_type: "code",
      state: state,
      display: "popup",
      // Embedded Signup specific parameters
      config_id: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "", // Optional: pre-configured setup
      setup_type: "standard", // or "advanced" for more control
    });

    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;

    console.log(`✓ Generated WhatsApp Embedded Signup URL for company ${companyId}`);

    return {
      authUrl,
      state,
    };
  } catch (error) {
    console.error("Error generating OAuth URL:", error);
    throw new Error(`Failed to generate OAuth URL: ${error.message}`);
  }
};

/**
 * Exchange authorization code for access token
 * @param {String} code - Authorization code from OAuth callback
 * @returns {Promise<Object>} { accessToken, tokenType, expiresIn }
 */
exports.exchangeCodeForToken = async (code) => {
  try {
    const response = await axios.post(`${META_GRAPH_API_BASE}/oauth/access_token`, null, {
      params: {
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: META_REDIRECT_URI,
        code: code,
      },
    });

    const { access_token, token_type, expires_in } = response.data;

    console.log("✓ Exchanged code for access token successfully");

    return {
      accessToken: access_token,
      tokenType: token_type,
      expiresIn: expires_in,
    };
  } catch (error) {
    console.error("Error exchanging code for token:", error.response?.data || error.message);
    throw new Error(`Failed to exchange code for token: ${error.response?.data?.error?.message || error.message}`);
  }
};

/**
 * Get WABA (WhatsApp Business Account) details from access token
 * @param {String} accessToken - Meta access token
 * @returns {Promise<Object>} { wabaId, businessId, businessName }
 */
exports.getWABADetails = async (accessToken) => {
  try {
    // Debug token to get WABA ID and permissions
    const debugResponse = await axios.get(`${META_GRAPH_API_BASE}/debug_token`, {
      params: {
        input_token: accessToken,
        access_token: `${META_APP_ID}|${META_APP_SECRET}`,
      },
    });

    const tokenData = debugResponse.data.data;

    // Get WABA ID from granular_scopes
    const wabaScope = tokenData.granular_scopes?.find(
      (scope) => scope.scope === "whatsapp_business_management"
    );

    if (!wabaScope || !wabaScope.target_ids || wabaScope.target_ids.length === 0) {
      throw new Error("No WhatsApp Business Account found in token. Please complete Embedded Signup.");
    }

    const wabaId = wabaScope.target_ids[0];

    // Get WABA details
    const wabaResponse = await axios.get(`${META_GRAPH_API_BASE}/${wabaId}`, {
      params: {
        fields: "id,name,account_review_status,business_verification_status,timezone_id,owner_business_info",
        access_token: accessToken,
      },
    });

    const wabaData = wabaResponse.data;

    // Get Business Manager ID (optional - not critical for functionality)
    let businessId = null;
    try {
      // Try to get business ID from WABA's owned_by field (more reliable)
      if (wabaData.owner_business_info?.id) {
        businessId = wabaData.owner_business_info.id;
      } else {
        // Alternative: try getting from client_whatsapp_business_accounts
        const businessResponse = await axios.get(`${META_GRAPH_API_BASE}/${wabaId}`, {
          params: {
            fields: "owner_business_info",
            access_token: accessToken,
          },
        });
        businessId = businessResponse.data.owner_business_info?.id || null;
      }

      if (businessId) {
        console.log(`✓ Retrieved business ID: ${businessId}`);
      }
    } catch (businessError) {
      // Business ID is optional - don't fail if we can't get it
      console.log(`⚠ Could not retrieve business ID (optional): ${businessError.message}`);
      businessId = null;
    }

    console.log(`✓ Retrieved WABA details: ${wabaId}`);

    return {
      wabaId: wabaData.id,
      wabaName: wabaData.name,
      businessId: businessId,
      accountReviewStatus: wabaData.account_review_status,
      businessVerificationStatus: wabaData.business_verification_status,
      timezoneId: wabaData.timezone_id,
    };
  } catch (error) {
    console.error("Error getting WABA details:", error.response?.data || error.message);
    throw new Error(`Failed to get WABA details: ${error.response?.data?.error?.message || error.message}`);
  }
};

/**
 * Link Twilio phone number to Meta WABA
 * @param {String} companyId - Company ID
 * @param {String} phoneNumber - Phone number in E.164 format
 * @returns {Promise<Object>} { phoneNumberId, displayName, verifiedName }
 */
exports.linkPhoneNumber = async (companyId, phoneNumber) => {
  try {
    const company = await Company.findById(companyId).select("+whatsappEmbeddedSignup.accessToken");

    if (!company || !company.whatsappEmbeddedSignup?.wabaId) {
      throw new Error("Company does not have a WhatsApp Business Account. Please complete Embedded Signup first.");
    }

    if (!company.whatsappEmbeddedSignup?.accessToken) {
      throw new Error("Meta access token not found. Please re-authenticate.");
    }

    const wabaId = company.whatsappEmbeddedSignup.wabaId;
    const accessToken = company.whatsappEmbeddedSignup.accessToken;

    // Parse country code from E.164 format (+14155551234)
    // Remove the leading '+'
    const numberWithoutPlus = phoneNumber.replace(/^\+/, '');

    // Extract country code and phone number
    // Common country codes: 1 (US/Canada), 44 (UK), 91 (India), etc.
    let countryCode;
    let localNumber;

    if (numberWithoutPlus.startsWith('1') && numberWithoutPlus.length === 11) {
      // North America (US, Canada) - country code is '1', followed by 10 digits
      countryCode = '1';
      localNumber = numberWithoutPlus.substring(1);
    } else if (numberWithoutPlus.startsWith('44') && numberWithoutPlus.length >= 11) {
      // UK - country code is '44'
      countryCode = '44';
      localNumber = numberWithoutPlus.substring(2);
    } else if (numberWithoutPlus.startsWith('91') && numberWithoutPlus.length === 12) {
      // India - country code is '91', followed by 10 digits
      countryCode = '91';
      localNumber = numberWithoutPlus.substring(2);
    } else if (numberWithoutPlus.startsWith('1') && numberWithoutPlus.length > 11) {
      // Fallback for other 1+ country codes
      countryCode = '1';
      localNumber = numberWithoutPlus.substring(1);
    } else {
      // Generic fallback: assume first 1-3 digits are country code
      // Try 3 digits first, then 2, then 1
      if (numberWithoutPlus.length > 10) {
        countryCode = numberWithoutPlus.substring(0, 2);
        localNumber = numberWithoutPlus.substring(2);
      } else {
        countryCode = numberWithoutPlus.substring(0, 1);
        localNumber = numberWithoutPlus.substring(1);
      }
    }

    console.log(`Parsed phone: cc=${countryCode}, number=${localNumber}`);

    // Get business name for verified_name (required by Meta)
    const verifiedName = company.whatsappEmbeddedSignup.businessName || company.name || "Business";

    // Register phone number with Meta WABA
    const response = await axios.post(
      `${META_GRAPH_API_BASE}/${wabaId}/phone_numbers`,
      {
        cc: countryCode,
        phone_number: localNumber,
        verified_name: verifiedName,
        migrate_phone_number: false,
      },
      {
        params: {
          access_token: accessToken,
        },
      }
    );

    const phoneNumberId = response.data.id;

    // Get phone number details
    const detailsResponse = await axios.get(`${META_GRAPH_API_BASE}/${phoneNumberId}`, {
      params: {
        fields: "id,display_phone_number,verified_name,code_verification_status,name_status,quality_rating",
        access_token: accessToken,
      },
    });

    const phoneData = detailsResponse.data;

    // Update company database
    await Company.findByIdAndUpdate(companyId, {
      $addToSet: {
        "whatsappEmbeddedSignup.phoneNumbers": {
          phoneNumber: phoneNumber,
          phoneNumberId: phoneData.id,
          displayName: phoneData.display_phone_number,
          verifiedName: phoneData.verified_name || null,
          nameStatus: phoneData.name_status || "NONE",
          codeVerificationStatus: phoneData.code_verification_status || "NOT_VERIFIED",
          qualityRating: phoneData.quality_rating || "UNKNOWN",
          registeredAt: new Date(),
        },
      },
      $set: {
        "whatsappEmbeddedSignup.lastSyncedAt": new Date(),
      },
    });

    // Also update twilioConfig.whatsappSenders
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "twilioConfig.whatsappSenders.$[elem].status": "active",
        "twilioConfig.whatsappSenders.$[elem].metaPhoneNumberId": phoneData.id,
        "twilioConfig.whatsappSenders.$[elem].registeredAt": new Date(),
      },
    }, {
      arrayFilters: [{ "elem.number": phoneNumber }],
    });

    console.log(`✓ Linked phone number ${phoneNumber} to WABA ${wabaId}`);

    return {
      phoneNumberId: phoneData.id,
      displayName: phoneData.display_phone_number,
      verifiedName: phoneData.verified_name,
      codeVerificationStatus: phoneData.code_verification_status,
      nameStatus: phoneData.name_status,
    };
  } catch (error) {
    console.error("Error linking phone number:", error.response?.data || error.message);
    throw new Error(`Failed to link phone number: ${error.response?.data?.error?.message || error.message}`);
  }
};

/**
 * Get phone number status from Meta
 * @param {String} companyId - Company ID
 * @param {String} phoneNumberId - Meta phone number ID
 * @returns {Promise<Object>} Phone number status
 */
exports.getPhoneNumberStatus = async (companyId, phoneNumberId) => {
  try {
    const company = await Company.findById(companyId).select("+whatsappEmbeddedSignup.accessToken");

    if (!company || !company.whatsappEmbeddedSignup?.accessToken) {
      throw new Error("Meta access token not found");
    }

    const accessToken = company.whatsappEmbeddedSignup.accessToken;

    const response = await axios.get(`${META_GRAPH_API_BASE}/${phoneNumberId}`, {
      params: {
        fields: "id,display_phone_number,verified_name,code_verification_status,name_status,quality_rating,is_official_business_account",
        access_token: accessToken,
      },
    });

    return response.data;
  } catch (error) {
    console.error("Error getting phone number status:", error.response?.data || error.message);
    throw new Error(`Failed to get phone number status: ${error.response?.data?.error?.message || error.message}`);
  }
};

/**
 * Get WABA status for company
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} WABA status
 */
exports.getWABAStatus = async (companyId) => {
  try {
    const company = await Company.findById(companyId).select("+whatsappEmbeddedSignup.accessToken");

    if (!company || !company.whatsappEmbeddedSignup?.wabaId) {
      throw new Error("Company does not have a WhatsApp Business Account");
    }

    const wabaId = company.whatsappEmbeddedSignup.wabaId;
    const accessToken = company.whatsappEmbeddedSignup.accessToken;

    // Get WABA details
    const wabaResponse = await axios.get(`${META_GRAPH_API_BASE}/${wabaId}`, {
      params: {
        fields: "id,name,account_review_status,business_verification_status,timezone_id,currency",
        access_token: accessToken,
      },
    });

    // Get phone numbers
    const phonesResponse = await axios.get(`${META_GRAPH_API_BASE}/${wabaId}/phone_numbers`, {
      params: {
        fields: "id,display_phone_number,verified_name,code_verification_status,name_status,quality_rating",
        access_token: accessToken,
      },
    });

    return {
      wabaId: wabaResponse.data.id,
      businessName: wabaResponse.data.name,
      accountReviewStatus: wabaResponse.data.account_review_status,
      businessVerificationStatus: wabaResponse.data.business_verification_status,
      verificationStatus: wabaResponse.data.account_review_status === "APPROVED" ? "verified" : "pending",
      phoneNumbers: phonesResponse.data.data || [],
    };
  } catch (error) {
    console.error("Error getting WABA status:", error.response?.data || error.message);
    throw new Error(`Failed to get WABA status: ${error.response?.data?.error?.message || error.message}`);
  }
};

/**
 * Refresh Meta access token
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { accessToken, expiresIn }
 */
exports.refreshAccessToken = async (companyId) => {
  try {
    const company = await Company.findById(companyId).select("+whatsappEmbeddedSignup.refreshToken");

    if (!company || !company.whatsappEmbeddedSignup?.refreshToken) {
      throw new Error("Refresh token not found. Please re-authenticate.");
    }

    // Note: Meta long-lived tokens (60 days) don't have refresh tokens
    // Instead, we need to exchange the existing token for a new long-lived one
    const currentToken = company.whatsappEmbeddedSignup.accessToken;

    const response = await axios.get(`${META_GRAPH_API_BASE}/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: currentToken,
      },
    });

    const { access_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Update company database
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "whatsappEmbeddedSignup.accessToken": access_token,
        "whatsappEmbeddedSignup.tokenExpiresAt": expiresAt,
        "whatsappEmbeddedSignup.lastSyncedAt": new Date(),
      },
    });

    console.log(`✓ Refreshed access token for company ${companyId}`);

    return {
      accessToken: access_token,
      expiresIn: expires_in,
      expiresAt: expiresAt,
    };
  } catch (error) {
    console.error("Error refreshing access token:", error.response?.data || error.message);
    throw new Error(`Failed to refresh access token: ${error.response?.data?.error?.message || error.message}`);
  }
};

/**
 * Verify state token from OAuth callback
 * @param {String} state - State token from callback
 * @param {String} companyId - Expected company ID
 * @returns {Promise<Object>} Decoded state data
 */
exports.verifyStateToken = async (state, companyId) => {
  try {
    const redis = getRedis();
    if (redis) {
      const storedState = await redis.get(`whatsapp_oauth_state:${companyId}`);
      if (storedState !== state) {
        throw new Error("Invalid or expired state token");
      }
      // Delete used state
      await redis.del(`whatsapp_oauth_state:${companyId}`);
    }

    // Decode state
    const stateData = JSON.parse(Buffer.from(state, "base64").toString("utf-8"));

    // Verify timestamp (max 10 minutes old)
    if (Date.now() - stateData.timestamp > 600000) {
      throw new Error("State token expired");
    }

    return stateData;
  } catch (error) {
    console.error("Error verifying state token:", error);
    throw new Error(`Invalid state token: ${error.message}`);
  }
};
