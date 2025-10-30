"use strict";

const { stripe } = require("../lib/stripeClient");
const {
  createAccount,
  findAccountByCompany,
  findAccountByStripeId,
  updateAccount,
} = require("../models/PaymentsStripeAccount");
const config = require("../config");

/**
 * Create Stripe Custom Connect account
 * @param {string} companyId - MongoDB company ID
 * @param {object} accountData - Account information
 * @param {object} tosData - TOS acceptance data (ip, userAgent)
 * @returns {object} Created account details
 */
exports.createConnectAccount = async (companyId, accountData, tosData) => {
  try {
    console.log(`Creating Stripe Connect account for company: ${companyId}`);

    // Check if account already exists
    const existingAccount = await findAccountByCompany(companyId);
    if (existingAccount) {
      console.log(`Stripe account already exists for company ${companyId}`);
      return {
        success: true,
        alreadyExists: true,
        accountId: existingAccount.stripeAccountId,
        account: existingAccount,
      };
    }

    // Prepare capabilities request
    const capabilities = {};
    config.connect.defaultCapabilities.forEach((cap) => {
      const capKey = cap === "card_payments" ? "card_payments" : cap;
      capabilities[capKey] = { requested: true };
    });

    // Create Stripe account
    const stripeAccount = await stripe.accounts.create({
      type: config.connect.accountType,
      country: accountData.country,
      email: accountData.email,
      business_type: accountData.businessType,
      capabilities,

      // Business profile
      business_profile: {
        name: accountData.businessInfo.legalName,
        url: accountData.businessInfo.url,
        mcc: accountData.businessInfo.mcc,
        product_description: accountData.businessInfo.description,
        support_email: accountData.publicDetails.supportEmail,
        support_phone: accountData.publicDetails.supportPhone,
        support_url: accountData.publicDetails.supportUrl,
      },

      // Company information
      company: {
        name: accountData.businessInfo.legalName,
        phone: accountData.businessInfo.phone,
        tax_id: accountData.businessInfo.taxId,
        address: {
          line1: accountData.businessInfo.address.line1,
          line2: accountData.businessInfo.address.line2 || undefined,
          city: accountData.businessInfo.address.city,
          state: accountData.businessInfo.address.state,
          postal_code: accountData.businessInfo.address.postalCode,
          country: accountData.businessInfo.address.country,
        },
      },

      // TOS acceptance
      tos_acceptance: {
        date: tosData.date || Math.floor(Date.now() / 1000),
        ip: tosData.ip,
        user_agent: tosData.userAgent,
      },

      // Settings
      settings: {
        payouts: {
          schedule: {
            interval: "manual", // Platform controls payouts
          },
        },
      },
    });

    console.log(`Stripe account created: ${stripeAccount.id}`);

    // Map capabilities
    const capabilitiesMap = {
      cardPayments: stripeAccount.capabilities?.card_payments || "inactive",
      transfers: stripeAccount.capabilities?.transfers || "inactive",
      issuing: stripeAccount.capabilities?.issuing || "inactive",
    };

    // Store in database (secrets will be auto-encrypted by pre-save hook)
    const accountRecord = await createAccount({
      companyId,
      stripeAccountId: stripeAccount.id,
      country: accountData.country,
      accountType: config.connect.accountType,
      businessType: accountData.businessType,
      email: accountData.email,
      capabilities: capabilitiesMap,
      chargesEnabled: stripeAccount.charges_enabled || false,
      payoutsEnabled: stripeAccount.payouts_enabled || false,
      detailsSubmitted: stripeAccount.details_submitted || false,
      onboardingComplete: false,
      publishableKey: config.stripe.publishableKey,
      businessInfo: accountData.businessInfo,
      publicDetails: accountData.publicDetails,
      accountRepresentative: accountData.accountRepresentative,
      ownership: accountData.ownership,
      requirements: {
        currentlyDue: stripeAccount.requirements?.currently_due || [],
        eventuallyDue: stripeAccount.requirements?.eventually_due || [],
        pastDue: stripeAccount.requirements?.past_due || [],
        disabledReason: stripeAccount.requirements?.disabled_reason || null,
      },
      tosAcceptance: {
        date: tosData.date || Math.floor(Date.now() / 1000),
        ip: tosData.ip,
        userAgent: tosData.userAgent,
      },
    });

    console.log(`Account stored in database: ${accountRecord._id}`);

    return {
      success: true,
      accountId: stripeAccount.id,
      account: accountRecord,
      requirements: accountRecord.requirements,
      capabilities: capabilitiesMap,
    };
  } catch (error) {
    console.error("Error creating Stripe Connect account:", error);
    throw new Error(`Failed to create Stripe Connect account: ${error.message}`);
  }
};

/**
 * Update Stripe Connect account information
 * @param {string} companyId - MongoDB company ID
 * @param {object} updates - Updated account information
 * @returns {object} Updated account
 */
exports.updateConnectAccount = async (companyId, updates) => {
  try {
    console.log(`Updating Stripe Connect account for company: ${companyId}`);

    // Find existing account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Prepare Stripe update payload
    const stripeUpdates = {};

    if (updates.businessInfo) {
      stripeUpdates.business_profile = {};
      if (updates.businessInfo.url) {
        stripeUpdates.business_profile.url = updates.businessInfo.url;
      }
      if (updates.businessInfo.description) {
        stripeUpdates.business_profile.product_description = updates.businessInfo.description;
      }
      if (updates.businessInfo.mcc) {
        stripeUpdates.business_profile.mcc = updates.businessInfo.mcc;
      }

      stripeUpdates.company = {};
      if (updates.businessInfo.phone) {
        stripeUpdates.company.phone = updates.businessInfo.phone;
      }
      if (updates.businessInfo.address) {
        stripeUpdates.company.address = {
          line1: updates.businessInfo.address.line1,
          line2: updates.businessInfo.address.line2 || undefined,
          city: updates.businessInfo.address.city,
          state: updates.businessInfo.address.state,
          postal_code: updates.businessInfo.address.postalCode,
          country: updates.businessInfo.address.country,
        };
      }
    }

    if (updates.publicDetails) {
      stripeUpdates.business_profile = stripeUpdates.business_profile || {};
      if (updates.publicDetails.supportEmail) {
        stripeUpdates.business_profile.support_email = updates.publicDetails.supportEmail;
      }
      if (updates.publicDetails.supportPhone) {
        stripeUpdates.business_profile.support_phone = updates.publicDetails.supportPhone;
      }
      if (updates.publicDetails.supportUrl) {
        stripeUpdates.business_profile.support_url = updates.publicDetails.supportUrl;
      }
    }

    // Update in Stripe
    if (Object.keys(stripeUpdates).length > 0) {
      await stripe.accounts.update(accountRecord.stripeAccountId, stripeUpdates);
      console.log(`Stripe account updated: ${accountRecord.stripeAccountId}`);
    }

    // Update in database
    const updatePayload = {};
    if (updates.businessInfo) {
      updatePayload["businessInfo"] = {
        ...accountRecord.businessInfo,
        ...updates.businessInfo,
      };
    }
    if (updates.publicDetails) {
      updatePayload["publicDetails"] = {
        ...accountRecord.publicDetails,
        ...updates.publicDetails,
      };
    }

    const updatedRecord = await updateAccount(
      { _id: accountRecord._id },
      updatePayload
    );

    return {
      success: true,
      account: updatedRecord,
    };
  } catch (error) {
    console.error("Error updating Stripe Connect account:", error);
    throw new Error(`Failed to update Stripe Connect account: ${error.message}`);
  }
};

/**
 * Add person (representative/owner) to Stripe account
 * @param {string} companyId - MongoDB company ID
 * @param {object} personData - Person information
 * @returns {object} Created person details
 */
exports.addAccountPerson = async (companyId, personData) => {
  try {
    console.log(`Adding person to Stripe account for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Create person in Stripe
    const person = await stripe.accounts.createPerson(
      accountRecord.stripeAccountId,
      {
        first_name: personData.firstName,
        last_name: personData.lastName,
        email: personData.email,
        phone: personData.phone,
        dob: {
          day: personData.dateOfBirth.day,
          month: personData.dateOfBirth.month,
          year: personData.dateOfBirth.year,
        },
        address: {
          line1: personData.address.line1,
          line2: personData.address.line2 || undefined,
          city: personData.address.city,
          state: personData.address.state,
          postal_code: personData.address.postalCode,
          country: personData.address.country,
        },
        relationship: {
          representative: personData.relationship.representative,
          owner: personData.relationship.owner,
          title: personData.relationship.title || undefined,
          percent_ownership: personData.relationship.percentOwnership || undefined,
        },
        ssn_last_4: personData.ssnLast4 || undefined,
        id_number: personData.idNumber || undefined,
      }
    );

    console.log(`Person created in Stripe: ${person.id}`);

    // Add to database record
    const personRecord = {
      personId: person.id,
      relationship: personData.relationship,
      firstName: personData.firstName,
      lastName: personData.lastName,
      email: personData.email,
      phone: personData.phone,
      dateOfBirth: personData.dateOfBirth,
      address: personData.address,
      verification: {
        status: person.verification?.status || "unverified",
      },
      createdAt: new Date(),
    };

    await updateAccount(
      { _id: accountRecord._id },
      { $push: { persons: personRecord } }
    );

    console.log(`Person added to database record`);

    return {
      success: true,
      personId: person.id,
      person: personRecord,
      verificationStatus: person.verification?.status,
    };
  } catch (error) {
    console.error("Error adding person to Stripe account:", error);
    throw new Error(`Failed to add person: ${error.message}`);
  }
};

/**
 * Upload verification document for person
 * @param {string} companyId - MongoDB company ID
 * @param {string} personId - Stripe person ID
 * @param {object} file - File buffer and metadata
 * @param {string} side - 'front' or 'back'
 * @returns {object} Upload result
 */
exports.uploadPersonDocument = async (companyId, personId, file, side = "front") => {
  try {
    console.log(`Uploading ${side} document for person: ${personId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Upload file to Stripe
    const stripeFile = await stripe.files.create({
      file: {
        data: file.buffer,
        name: file.originalname,
        type: file.mimetype,
      },
      purpose: "identity_document",
    });

    console.log(`File uploaded to Stripe: ${stripeFile.id}`);

    // Update person with document
    const updateData = {};
    if (side === "front") {
      updateData["verification.document.front"] = stripeFile.id;
    } else {
      updateData["verification.document.back"] = stripeFile.id;
    }

    await stripe.accounts.updatePerson(
      accountRecord.stripeAccountId,
      personId,
      updateData
    );

    // Update database record
    await updateAccount(
      {
        _id: accountRecord._id,
        "persons.personId": personId,
      },
      {
        $set: {
          [`persons.$.verification.document.${side}`]: stripeFile.id,
        },
      }
    );

    return {
      success: true,
      fileId: stripeFile.id,
      side,
    };
  } catch (error) {
    console.error("Error uploading document:", error);
    throw new Error(`Failed to upload document: ${error.message}`);
  }
};

/**
 * Get account status and requirements
 * @param {string} companyId - MongoDB company ID
 * @returns {object} Account status
 */
exports.getAccountStatus = async (companyId) => {
  try {
    console.log(`Fetching account status for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Fetch latest from Stripe
    const stripeAccount = await stripe.accounts.retrieve(accountRecord.stripeAccountId);

    // Update local record with latest status
    const updates = {
      chargesEnabled: stripeAccount.charges_enabled,
      payoutsEnabled: stripeAccount.payouts_enabled,
      detailsSubmitted: stripeAccount.details_submitted,
      "capabilities.cardPayments": stripeAccount.capabilities?.card_payments || "inactive",
      "capabilities.transfers": stripeAccount.capabilities?.transfers || "inactive",
      "capabilities.issuing": stripeAccount.capabilities?.issuing || "inactive",
      "requirements.currentlyDue": stripeAccount.requirements?.currently_due || [],
      "requirements.eventuallyDue": stripeAccount.requirements?.eventually_due || [],
      "requirements.pastDue": stripeAccount.requirements?.past_due || [],
      "requirements.disabledReason": stripeAccount.requirements?.disabled_reason || null,
    };

    // Check if onboarding complete
    const onboardingComplete =
      stripeAccount.charges_enabled &&
      stripeAccount.payouts_enabled &&
      stripeAccount.details_submitted &&
      (!stripeAccount.requirements?.currently_due?.length) &&
      (!stripeAccount.requirements?.past_due?.length);

    updates.onboardingComplete = onboardingComplete;

    const updatedRecord = await updateAccount(
      { _id: accountRecord._id },
      updates
    );

    return {
      success: true,
      accountId: accountRecord.stripeAccountId,
      chargesEnabled: stripeAccount.charges_enabled,
      payoutsEnabled: stripeAccount.payouts_enabled,
      onboardingComplete,
      detailsSubmitted: stripeAccount.details_submitted,
      capabilities: {
        cardPayments: stripeAccount.capabilities?.card_payments || "inactive",
        transfers: stripeAccount.capabilities?.transfers || "inactive",
        issuing: stripeAccount.capabilities?.issuing || "inactive",
      },
      requirements: {
        currentlyDue: stripeAccount.requirements?.currently_due || [],
        eventuallyDue: stripeAccount.requirements?.eventually_due || [],
        pastDue: stripeAccount.requirements?.past_due || [],
        disabledReason: stripeAccount.requirements?.disabled_reason || null,
        currentDeadline: stripeAccount.requirements?.current_deadline || null,
      },
      persons: updatedRecord.persons,
      externalAccounts: updatedRecord.externalAccounts,
    };
  } catch (error) {
    console.error("Error fetching account status:", error);
    throw new Error(`Failed to fetch account status: ${error.message}`);
  }
};

/**
 * Add external bank account for payouts
 * @param {string} companyId - MongoDB company ID
 * @param {object} bankData - Bank account information
 * @returns {object} Bank account details
 */
exports.addExternalAccount = async (companyId, bankData) => {
  try {
    console.log(`Adding external bank account for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Create bank account token
    const token = await stripe.tokens.create({
      bank_account: {
        country: bankData.country,
        currency: bankData.currency,
        account_holder_name: bankData.accountHolderName,
        account_holder_type: bankData.accountHolderType,
        routing_number: bankData.routingNumber,
        account_number: bankData.accountNumber,
      },
    });

    // Attach to connected account
    const bankAccount = await stripe.accounts.createExternalAccount(
      accountRecord.stripeAccountId,
      {
        external_account: token.id,
        default_for_currency: true,
      }
    );

    console.log(`Bank account added: ${bankAccount.id}`);

    // Add to database record
    const bankRecord = {
      bankAccountId: bankAccount.id,
      accountHolderName: bankAccount.account_holder_name,
      accountHolderType: bankAccount.account_holder_type,
      bankName: bankAccount.bank_name || "Unknown",
      country: bankAccount.country,
      currency: bankAccount.currency,
      last4: bankAccount.last4,
      routingNumber: bankAccount.routing_number,
      isDefault: bankAccount.default_for_currency,
      createdAt: new Date(),
    };

    await updateAccount(
      { _id: accountRecord._id },
      { $push: { externalAccounts: bankRecord } }
    );

    console.log(`Bank account added to database record`);

    return {
      success: true,
      bankAccountId: bankAccount.id,
      bankAccount: {
        ...bankRecord,
        accountNumber: undefined, // Never return full account number
      },
    };
  } catch (error) {
    console.error("Error adding external bank account:", error);
    throw new Error(`Failed to add bank account: ${error.message}`);
  }
};

/**
 * Sync account data from Stripe webhook event
 * @param {object} event - Stripe webhook event
 * @returns {object} Sync result
 */
exports.syncAccountFromWebhook = async (event) => {
  try {
    const stripeAccount = event.data.object;
    const accountId = event.account || stripeAccount.id;

    console.log(`Syncing account from webhook: ${accountId}, event: ${event.type}`);

    // Find account in database
    const accountRecord = await findAccountByStripeId(accountId);
    if (!accountRecord) {
      console.log(`Account not found in database: ${accountId}`);
      return { success: false, reason: "account_not_found" };
    }

    // Update based on event type
    const updates = {};

    if (event.type === "account.updated") {
      updates.chargesEnabled = stripeAccount.charges_enabled;
      updates.payoutsEnabled = stripeAccount.payouts_enabled;
      updates.detailsSubmitted = stripeAccount.details_submitted;
      updates["requirements.currentlyDue"] = stripeAccount.requirements?.currently_due || [];
      updates["requirements.eventuallyDue"] = stripeAccount.requirements?.eventually_due || [];
      updates["requirements.pastDue"] = stripeAccount.requirements?.past_due || [];
      updates["requirements.disabledReason"] = stripeAccount.requirements?.disabled_reason || null;

      if (stripeAccount.capabilities) {
        updates["capabilities.cardPayments"] = stripeAccount.capabilities.card_payments || "inactive";
        updates["capabilities.transfers"] = stripeAccount.capabilities.transfers || "inactive";
        updates["capabilities.issuing"] = stripeAccount.capabilities.issuing || "inactive";
      }

      // Check if onboarding complete
      updates.onboardingComplete =
        stripeAccount.charges_enabled &&
        stripeAccount.payouts_enabled &&
        stripeAccount.details_submitted &&
        (!stripeAccount.requirements?.currently_due?.length) &&
        (!stripeAccount.requirements?.past_due?.length);
    }

    if (event.type === "capability.updated") {
      const capability = stripeAccount.id; // For capability events, object is the capability itself
      const capabilityName = stripeAccount.object === "capability" ? event.data.object : null;

      if (capabilityName) {
        const capKey = capabilityName.replace("_", "");
        updates[`capabilities.${capKey}`] = stripeAccount.status || "inactive";
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      await updateAccount({ _id: accountRecord._id }, updates);
      console.log(`Account synced: ${accountId}`);
    }

    return { success: true, updated: Object.keys(updates).length > 0 };
  } catch (error) {
    console.error("Error syncing account from webhook:", error);
    return { success: false, error: error.message };
  }
};
