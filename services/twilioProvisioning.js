"use strict";

/**
 * Twilio Provisioning Service
 *
 * Handles creating Twilio subaccounts and purchasing phone numbers for companies
 * All Twilio details are hidden from companies - they just see "SMS" or "WhatsApp"
 *
 * Functions:
 * - Create subaccount for company
 * - Search available phone numbers
 * - Purchase phone numbers (SMS or WhatsApp)
 * - Create Messaging Services
 * - Test configuration
 */

const { getMasterClient } = require("../config/twilio");
const { model: mongooseModel } = require("mongoose");
const Company = mongooseModel("Company");
const twilio = require("twilio");

/**
 * Create Twilio subaccount for a company
 * This isolates billing and credentials per company
 *
 * @param {String} companyId - Company ID
 * @param {String} friendlyName - Optional friendly name for subaccount
 * @returns {Promise<Object>} { success, subAccountSid, apiKeySid }
 */
exports.createSubaccount = async (companyId, friendlyName = null) => {
  try {
    const masterClient = getMasterClient();

    // Fetch company
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error("Company not found");
    }

    // Check if company already has a subaccount
    if (company.twilioConfig?.subAccountSid && company.twilioConfig?.useTwilioSubaccount) {
      return {
        success: true,
        alreadyExists: true,
        subAccountSid: company.twilioConfig.subAccountSid,
        message: "Company already has a Twilio subaccount"
      };
    }

    const subaccountName = friendlyName || `${company.name} (ID: ${companyId})`;
    let subaccount;
    let apiKey;

    console.log(`Creating Twilio subaccount for company ${companyId}: ${subaccountName}`);

    // Try to create subaccount via Twilio API
    try {
      subaccount = await masterClient.api.accounts.create({
        friendlyName: subaccountName
      });
      console.log(`✓ Subaccount created: ${subaccount.sid}`);
    } catch (createError) {
      // If subaccount limit reached, try to find existing one
      if (createError.code === 21480) {
        console.log("⚠️ Subaccount limit reached, searching for existing subaccount...");

        // List all subaccounts to find one with matching name
        const subaccounts = await masterClient.api.accounts.list({
          friendlyName: subaccountName,
          limit: 1
        });

        if (subaccounts.length > 0) {
          subaccount = subaccounts[0];
          console.log(`✓ Found existing subaccount: ${subaccount.sid}`);
        } else {
          throw new Error(
            "Twilio subaccount limit reached. " +
            "Please delete unused subaccounts from Twilio Console (console.twilio.com → Account → Subaccounts) " +
            "or upgrade your Twilio account to create more subaccounts."
          );
        }
      } else {
        throw createError;
      }
    }

    // Create API Key for the subaccount (preferred over auth token)
    // Must authenticate AS the subaccount to create its API keys
    console.log(`Creating API key for subaccount ${subaccount.sid}...`);

    const subaccountClient = twilio(subaccount.sid, subaccount.authToken);
    apiKey = await subaccountClient.newKeys.create({
      friendlyName: `API Key for ${company.name}`
    });

    console.log(`✓ API Key created: ${apiKey.sid}`);

    // Update company in database
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "twilioConfig.subAccountSid": subaccount.sid,
        "twilioConfig.authToken": subaccount.authToken,
        "twilioConfig.apiKeySid": apiKey.sid,
        "twilioConfig.apiKeySecret": apiKey.secret,
        "twilioConfig.useTwilioSubaccount": true,
        "twilioConfig.active": false, // Not active until phone number added
        "twilioConfig.provisioningStatus": "in_progress",
        "twilioConfig.healthCheckStatus": "pending",
        "twilioConfig.lastHealthCheck": new Date()
      }
    });

    console.log(`✓ Company ${companyId} updated with subaccount credentials`);

    return {
      success: true,
      subAccountSid: subaccount.sid,
      apiKeySid: apiKey.sid,
      message: "Subaccount created successfully"
    };
  } catch (error) {
    console.error("Error creating Twilio subaccount:", error);

    // Update provisioning status to failed
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "twilioConfig.provisioningStatus": "failed"
      }
    });

    throw new Error(`Failed to create subaccount: ${error.message}`);
  }
};

/**
 * Search for available phone numbers in specified area code
 *
 * @param {String} companyId - Company ID
 * @param {Object} params - Search parameters
 * @param {String} params.areaCode - 3-digit area code (e.g., "415")
 * @param {String} params.country - 2-letter country code (default: "US")
 * @param {Number} params.limit - Max results to return (default: 10)
 * @returns {Promise<Object>} { success, numbers: [...] }
 */
exports.searchPhoneNumbers = async (companyId, { areaCode, country = "US", limit = 10 }) => {
  try {
    // Get company subaccount
    const company = await Company.findById(companyId)
      .select("+twilioConfig.apiKeySecret");

    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.twilioConfig?.subAccountSid) {
      throw new Error("Company does not have a Twilio subaccount. Please provision subaccount first.");
    }

    // Create client for this subaccount
    const subaccountClient = twilio(
      company.twilioConfig.apiKeySid,
      company.twilioConfig.apiKeySecret,
      { accountSid: company.twilioConfig.subAccountSid }
    );

    console.log(`Searching phone numbers for company ${companyId}, area code ${areaCode}, country ${country}`);

    // Search for available numbers
    const availableNumbers = await subaccountClient
      .availablePhoneNumbers(country)
      .local
      .list({
        areaCode: areaCode,
        smsEnabled: true,
        mmsEnabled: true,
        limit: limit
      });

    // Format response
    const numbers = availableNumbers.map(num => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName,
      locality: num.locality,
      region: num.region,
      postalCode: num.postalCode,
      capabilities: {
        sms: num.capabilities.sms,
        mms: num.capabilities.mms,
        voice: num.capabilities.voice
      }
    }));

    console.log(`✓ Found ${numbers.length} available numbers`);

    return {
      success: true,
      numbers,
      count: numbers.length
    };
  } catch (error) {
    console.error("Error searching phone numbers:", error);
    throw new Error(`Failed to search phone numbers: ${error.message}`);
  }
};

/**
 * Purchase a phone number for SMS or WhatsApp
 * Automatically configures webhooks for the number
 *
 * @param {String} companyId - Company ID
 * @param {String} phoneNumber - Phone number in E.164 format (e.g., "+15551234567")
 * @param {String} type - Type of number: "sms" or "whatsapp"
 * @returns {Promise<Object>} { success, phoneNumber, sid }
 */
exports.purchasePhoneNumber = async (companyId, phoneNumber, type = "sms") => {
  try {
    // Get company subaccount
    const company = await Company.findById(companyId)
      .select("+twilioConfig.apiKeySecret");

    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.twilioConfig?.subAccountSid) {
      throw new Error("Company does not have a Twilio subaccount. Please provision subaccount first.");
    }

    // Create client for this subaccount
    const subaccountClient = twilio(
      company.twilioConfig.apiKeySid,
      company.twilioConfig.apiKeySecret,
      { accountSid: company.twilioConfig.subAccountSid }
    );

    // Build webhook URLs
    const backendUrl = process.env.BACKEND_URL || "https://boardd.com";
    const smsStatusCallback = `${backendUrl}/api/webhooks/sms/twilio?companyId=${companyId}`;
    const smsInboundUrl = `${backendUrl}/api/webhooks/sms/twilio/inbound`;
    const whatsappStatusCallback = `${backendUrl}/api/webhooks/whatsapp/twilio?companyId=${companyId}`;
    const whatsappInboundUrl = `${backendUrl}/api/webhooks/whatsapp/twilio/inbound`;

    // Check if number already owned (for enabling WhatsApp on existing SMS number)
    const existingNumbers = company.twilioConfig?.fromNumbers || [];
    const numberAlreadyOwned = existingNumbers.includes(phoneNumber);

    let purchasedNumber;
    let numberSid;

    if (numberAlreadyOwned && type === "whatsapp") {
      // Number already owned - just enable WhatsApp on it
      console.log(`Phone number ${phoneNumber} already owned. Enabling WhatsApp...`);

      // Find the number SID
      const numbers = await subaccountClient.incomingPhoneNumbers.list();
      const existingNumber = numbers.find(n => n.phoneNumber === phoneNumber);

      if (!existingNumber) {
        throw new Error(`Number ${phoneNumber} not found in Twilio account`);
      }

      // Update webhooks to support WhatsApp
      await subaccountClient.incomingPhoneNumbers(existingNumber.sid).update({
        smsUrl: whatsappInboundUrl,
        smsMethod: "POST",
        statusCallback: whatsappStatusCallback,
        statusCallbackMethod: "POST"
      });

      numberSid = existingNumber.sid;
      console.log(`✓ WhatsApp enabled on existing number: ${phoneNumber}`);
    } else {
      // Purchase new number
      console.log(`Purchasing ${type} phone number ${phoneNumber} for company ${companyId}`);

      const purchaseConfig = {
        phoneNumber: phoneNumber
      };

      // Configure webhooks based on type
      if (type === "sms") {
        purchaseConfig.smsUrl = smsInboundUrl;
        purchaseConfig.smsMethod = "POST";
        purchaseConfig.statusCallback = smsStatusCallback;
        purchaseConfig.statusCallbackMethod = "POST";
      } else if (type === "whatsapp") {
        purchaseConfig.smsUrl = whatsappInboundUrl;
        purchaseConfig.smsMethod = "POST";
        purchaseConfig.statusCallback = whatsappStatusCallback;
        purchaseConfig.statusCallbackMethod = "POST";
      }

      purchasedNumber = await subaccountClient
        .incomingPhoneNumbers
        .create(purchaseConfig);

      numberSid = purchasedNumber.sid;
      console.log(`✓ Phone number purchased: ${phoneNumber}, SID: ${numberSid}`);
    }

    // Update company in database
    const updateFields = {
      $addToSet: {
        "twilioConfig.fromNumbers": phoneNumber,
        "twilioConfig.phoneNumberSids": numberSid
      },
      $set: {
        "twilioConfig.active": true, // Now active with phone number
        "twilioConfig.provisioningStatus": "completed"
      }
    };

    // If WhatsApp, also add to whatsappSenders
    if (type === "whatsapp") {
      updateFields.$push = {
        "twilioConfig.whatsappSenders": {
          number: phoneNumber,
          twilioNumber: phoneNumber,
          status: "pending", // Meta approval pending
          wabaId: null
        }
      };
    }

    await Company.findByIdAndUpdate(companyId, updateFields);

    console.log(`✓ Company ${companyId} updated with phone number`);

    const message = numberAlreadyOwned && type === "whatsapp"
      ? `WhatsApp enabled on existing number ${phoneNumber}`
      : `Phone number purchased and configured for ${type}`;

    return {
      success: true,
      phoneNumber: phoneNumber,
      sid: numberSid,
      type: type,
      reusingExistingNumber: numberAlreadyOwned && type === "whatsapp",
      webhooksConfigured: true,
      message: message
    };
  } catch (error) {
    console.error("Error purchasing phone number:", error);

    // If error contains specific Twilio error code, provide better message
    if (error.code === 21452) {
      throw new Error("This phone number is not available for purchase");
    }

    throw new Error(`Failed to purchase phone number: ${error.message}`);
  }
};

/**
 * Create a Messaging Service for the company
 * Messaging Services provide load balancing and sticky sender functionality
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, messagingServiceSid }
 */
exports.createMessagingService = async (companyId) => {
  try {
    // Get company subaccount
    const company = await Company.findById(companyId)
      .select("+twilioConfig.apiKeySecret");

    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.twilioConfig?.subAccountSid) {
      throw new Error("Company does not have a Twilio subaccount");
    }

    if (!company.twilioConfig.phoneNumberSids || company.twilioConfig.phoneNumberSids.length === 0) {
      throw new Error("Company has no phone numbers. Purchase a phone number first.");
    }

    // Check if already has messaging service
    if (company.twilioConfig.messagingServiceSid) {
      return {
        success: true,
        alreadyExists: true,
        messagingServiceSid: company.twilioConfig.messagingServiceSid,
        message: "Company already has a Messaging Service"
      };
    }

    // Create client for this subaccount
    const subaccountClient = twilio(
      company.twilioConfig.apiKeySid,
      company.twilioConfig.apiKeySecret,
      { accountSid: company.twilioConfig.subAccountSid }
    );

    console.log(`Creating Messaging Service for company ${companyId}`);

    // Create messaging service
    const service = await subaccountClient.messaging.v1.services.create({
      friendlyName: `${company.name} Messaging Service`,
      stickySender: true, // Use same sender number for same recipient
      usecase: "marketing" // or "notifications", "authentication"
    });

    console.log(`✓ Messaging Service created: ${service.sid}`);

    // Add all phone numbers to the service
    for (const phoneNumberSid of company.twilioConfig.phoneNumberSids) {
      await subaccountClient.messaging.v1
        .services(service.sid)
        .phoneNumbers
        .create({ phoneNumberSid });

      console.log(`✓ Added phone number ${phoneNumberSid} to Messaging Service`);
    }

    // Update company in database
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "twilioConfig.messagingServiceSid": service.sid
      }
    });

    console.log(`✓ Company ${companyId} updated with Messaging Service`);

    return {
      success: true,
      messagingServiceSid: service.sid,
      phoneNumbersAdded: company.twilioConfig.phoneNumberSids.length,
      message: "Messaging Service created successfully"
    };
  } catch (error) {
    console.error("Error creating Messaging Service:", error);
    throw new Error(`Failed to create Messaging Service: ${error.message}`);
  }
};

/**
 * Test company's Twilio configuration
 * Validates credentials and checks account status
 *
 * @param {String} companyId - Company ID
 * @returns {Promise<Object>} { success, accountStatus, balance, phoneNumbers }
 */
exports.testConfiguration = async (companyId) => {
  try {
    // Get company subaccount
    const company = await Company.findById(companyId)
      .select("+twilioConfig.apiKeySecret");

    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.twilioConfig?.subAccountSid) {
      return {
        success: false,
        error: "No Twilio subaccount configured"
      };
    }

    // Create client for this subaccount
    const subaccountClient = twilio(
      company.twilioConfig.apiKeySid,
      company.twilioConfig.apiKeySecret,
      { accountSid: company.twilioConfig.subAccountSid }
    );

    console.log(`Testing Twilio configuration for company ${companyId}`);

    // Fetch account details (validates credentials)
    const account = await subaccountClient.api
      .accounts(company.twilioConfig.subAccountSid)
      .fetch();

    // Fetch phone numbers
    const phoneNumbers = await subaccountClient.incomingPhoneNumbers.list();

    // Update health status in database
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "twilioConfig.healthCheckStatus": "healthy",
        "twilioConfig.lastHealthCheck": new Date()
      }
    });

    console.log(`✓ Twilio configuration test successful for company ${companyId}`);

    return {
      success: true,
      accountStatus: account.status,
      accountType: account.type,
      phoneNumbers: phoneNumbers.map(num => ({
        phoneNumber: num.phoneNumber,
        sid: num.sid,
        capabilities: num.capabilities
      })),
      phoneNumberCount: phoneNumbers.length,
      healthStatus: "healthy"
    };
  } catch (error) {
    console.error("Error testing Twilio configuration:", error);

    // Update health status to failed
    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "twilioConfig.healthCheckStatus": "failed",
        "twilioConfig.lastHealthCheck": new Date()
      }
    });

    return {
      success: false,
      error: error.message,
      healthStatus: "failed"
    };
  }
};

/**
 * Send a test SMS message
 *
 * @param {String} companyId - Company ID
 * @param {String} to - Recipient phone number (E.164 format)
 * @param {String} message - Test message text
 * @returns {Promise<Object>} { success, messageSid }
 */
exports.sendTestSms = async (companyId, to, message = "This is a test SMS from your messaging configuration.") => {
  try {
    const smsProvider = require("../providers/sms.twilio");

    console.log(`Sending test SMS for company ${companyId} to ${to}`);

    const result = await smsProvider.sendSms({
      companyId,
      to,
      textContent: message,
      messageId: null // No message tracking for test
    });

    if (result.success) {
      console.log(`✓ Test SMS sent successfully: ${result.providerMessageId}, from: ${result.from}`);

      // Update health status to healthy on successful send
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "twilioConfig.healthCheckStatus": "healthy",
          "twilioConfig.lastHealthCheck": new Date()
        }
      });

      console.log(`✓ Updated health status to 'healthy' for company ${companyId}`);

      return {
        success: true,
        messageSid: result.providerMessageId,
        status: result.status,
        from: result.from
      };
    } else {
      throw new Error(result.error || "SMS send failed");
    }
  } catch (error) {
    console.error(`Error sending test SMS for company ${companyId}:`, error);
    console.error(`Error details: ${JSON.stringify(error, null, 2)}`);

    // Update health status to failed on error
    try {
      await Company.findByIdAndUpdate(companyId, {
        $set: {
          "twilioConfig.healthCheckStatus": "failed",
          "twilioConfig.lastHealthCheck": new Date()
        }
      });
    } catch (updateError) {
      console.error("Failed to update health status:", updateError);
    }

    throw new Error(`Failed to send test SMS: ${error.message}`);
  }
};

/**
 * Get webhook configuration for a phone number
 * Useful for debugging inbound SMS/WhatsApp issues
 *
 * @param {String} companyId - Company ID
 * @param {String} phoneNumber - Phone number to check (E.164 format)
 * @returns {Promise<Object>} { phoneNumber, smsUrl, smsMethod, statusCallback, webhookConfigured }
 */
exports.getPhoneNumberWebhookConfig = async (companyId, phoneNumber) => {
  try {
    const company = await Company.findById(companyId)
      .select("+twilioConfig.apiKeySecret");

    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.twilioConfig?.subAccountSid) {
      throw new Error("Company does not have a Twilio subaccount");
    }

    // Create client for this subaccount
    const subaccountClient = twilio(
      company.twilioConfig.apiKeySid,
      company.twilioConfig.apiKeySecret,
      { accountSid: company.twilioConfig.subAccountSid }
    );

    console.log(`Fetching webhook config for phone number ${phoneNumber}`);

    // List all incoming phone numbers
    const numbers = await subaccountClient.incomingPhoneNumbers.list();
    const number = numbers.find(n => n.phoneNumber === phoneNumber);

    if (!number) {
      throw new Error(`Phone number ${phoneNumber} not found in Twilio account`);
    }

    const backendUrl = process.env.BACKEND_URL || "https://boardd.com";
    const expectedSmsUrl = `${backendUrl}/api/webhooks/sms/twilio/inbound`;
    const expectedStatusCallback = `${backendUrl}/api/webhooks/sms/twilio?companyId=${companyId}`;

    const webhookConfigured = number.smsUrl === expectedSmsUrl;
    const statusCallbackConfigured = number.statusCallback && number.statusCallback.includes('/api/webhooks/sms/twilio');

    console.log(`Phone number ${phoneNumber} webhook config:`, {
      smsUrl: number.smsUrl,
      expected: expectedSmsUrl,
      configured: webhookConfigured
    });

    return {
      success: true,
      phoneNumber: number.phoneNumber,
      friendlyName: number.friendlyName,
      smsUrl: number.smsUrl,
      smsMethod: number.smsMethod,
      statusCallback: number.statusCallback,
      statusCallbackMethod: number.statusCallbackMethod,
      expectedSmsUrl,
      expectedStatusCallback,
      webhookConfigured,
      statusCallbackConfigured,
      capabilities: number.capabilities
    };
  } catch (error) {
    console.error("Error getting phone number webhook config:", error);
    throw new Error(`Failed to get webhook config: ${error.message}`);
  }
};
