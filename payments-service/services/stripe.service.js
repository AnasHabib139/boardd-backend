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

    // Extract business name for email settings
    const businessName = accountData.business_profile?.name ||
                        accountData.company?.name ||
                        accountData.individual?.first_name
                          ? `${accountData.individual.first_name} ${accountData.individual.last_name || ''}`.trim()
                          : null;

    // Build account creation request (Stripe format - pass through directly)
    const createAccountRequest = {
      type: config.connect.accountType,
      country: accountData.country,
      email: accountData.email,
      business_type: accountData.business_type,
      capabilities,

      // Settings (always set for platform control + email delivery)
      settings: {
        ...(accountData.settings || {}),
        payouts: {
          schedule: {
            interval: "manual", // Platform controls payouts
          },
        },
        // Required for invoice email delivery
        dashboard: {
          display_name: businessName || accountData.email || 'Business',
          ...(accountData.settings?.dashboard || {})
        }
      },
    };

    // Pass through Stripe objects directly (no mapping needed!)
    if (accountData.company) {
      createAccountRequest.company = accountData.company;
    }

    if (accountData.business_profile) {
      createAccountRequest.business_profile = accountData.business_profile;
    }

    if (accountData.individual) {
      createAccountRequest.individual = accountData.individual;
    }

    // TOS acceptance - auto-capture IP and timestamp if provided
    if (accountData.tos_acceptance || tosData?.ip) {
      createAccountRequest.tos_acceptance = {
        ...accountData.tos_acceptance,
        date: accountData.tos_acceptance?.date || tosData?.date || Math.floor(Date.now() / 1000),
        ip: accountData.tos_acceptance?.ip || tosData?.ip,
        user_agent: accountData.tos_acceptance?.user_agent || tosData?.userAgent,
      };
    }

    console.log('Creating Stripe account with minimal fields:', Object.keys(createAccountRequest));

    // Create Stripe account
    const stripeAccount = await stripe.accounts.create(createAccountRequest);

    console.log(`Stripe account created: ${stripeAccount.id}`);

    // Map capabilities
    const capabilitiesMap = {
      cardPayments: stripeAccount.capabilities?.card_payments || "inactive",
      transfers: stripeAccount.capabilities?.transfers || "inactive",
      issuing: stripeAccount.capabilities?.card_issuing || "inactive",
    };

    // Store in database (secrets will be auto-encrypted by pre-save hook)
    const accountRecord = await createAccount({
      companyId,
      stripeAccountId: stripeAccount.id,
      country: accountData.country,
      accountType: config.connect.accountType,
      businessType: accountData.business_type,
      email: accountData.email,
      capabilities: capabilitiesMap,
      chargesEnabled: stripeAccount.charges_enabled || false,
      payoutsEnabled: stripeAccount.payouts_enabled || false,
      detailsSubmitted: stripeAccount.details_submitted || false,
      onboardingComplete: false,
      publishableKey: config.stripe.publishableKey,
      requirements: {
        currentlyDue: stripeAccount.requirements?.currently_due || [],
        eventuallyDue: stripeAccount.requirements?.eventually_due || [],
        pastDue: stripeAccount.requirements?.past_due || [],
        disabledReason: stripeAccount.requirements?.disabled_reason || null,
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

    // Prepare Stripe update payload - pass through directly (no mapping needed!)
    const stripeUpdates = {};

    // Pass through Stripe objects directly
    if (updates.company) {
      stripeUpdates.company = updates.company;
    }

    if (updates.business_profile) {
      stripeUpdates.business_profile = updates.business_profile;
    }

    if (updates.tos_acceptance) {
      stripeUpdates.tos_acceptance = updates.tos_acceptance;
    }

    if (updates.settings) {
      stripeUpdates.settings = updates.settings;
    }

    if (updates.individual) {
      stripeUpdates.individual = updates.individual;
    }

    // Note: 'representative' is NOT a valid parameter for companies
    // For company accounts, use Person API with relationship.representative: true

    // Update in Stripe
    if (Object.keys(stripeUpdates).length > 0) {
      console.log('Sending to Stripe:', JSON.stringify(stripeUpdates, null, 2));
      const updatedAccount = await stripe.accounts.update(accountRecord.stripeAccountId, stripeUpdates);
      console.log(`Stripe account updated: ${accountRecord.stripeAccountId}`);
      console.log('Stripe requirements after update:', JSON.stringify(updatedAccount.requirements?.currently_due, null, 2));
    }

    // Note: DB sync happens via webhooks or next getAccountStatus() call
    // No need to update DB here since Stripe is source of truth

    return {
      success: true,
      account: accountRecord,
    };
  } catch (error) {
    console.error("Error updating Stripe Connect account:", error);
    throw new Error(`Failed to update Stripe Connect account: ${error.message}`);
  }
};

/**
 * Fix email settings for existing connected account
 * Adds dashboard display_name if missing (required for invoice email delivery)
 * @param {string} companyId - MongoDB company ID
 * @returns {object} Update result
 */
exports.fixAccountEmailSettings = async (companyId) => {
  try {
    console.log(`Fixing email settings for company: ${companyId}`);

    // Find existing account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Get current account info
    const account = await stripe.accounts.retrieve(accountRecord.stripeAccountId);

    // Check if email settings already configured
    if (account.settings?.dashboard?.display_name || account.business_profile?.name) {
      console.log('Email settings already configured');
      return {
        success: true,
        message: 'Email settings already configured',
        displayName: account.settings?.dashboard?.display_name,
        businessName: account.business_profile?.name
      };
    }

    // Extract business name
    const businessName = account.business_profile?.name ||
                        account.company?.name ||
                        account.individual?.first_name
                          ? `${account.individual.first_name} ${account.individual.last_name || ''}`.trim()
                          : account.email ||
                            'Business';

    // Update account with email settings
    const updatedAccount = await stripe.accounts.update(
      accountRecord.stripeAccountId,
      {
        settings: {
          dashboard: {
            display_name: businessName
          }
        }
      }
    );

    console.log(`Email settings fixed - display_name set to: ${businessName}`);

    return {
      success: true,
      message: 'Email settings updated successfully',
      displayName: updatedAccount.settings.dashboard.display_name
    };
  } catch (error) {
    console.error("Error fixing account email settings:", error);
    throw new Error(`Failed to fix account email settings: ${error.message}`);
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

    // Create person in Stripe (pass through Stripe format directly)
    const person = await stripe.accounts.createPerson(
      accountRecord.stripeAccountId,
      personData
    );

    console.log(`Person created in Stripe: ${person.id}`);

    // Add to database record (store minimal info)
    const personRecord = {
      personId: person.id,
      first_name: person.first_name,
      last_name: person.last_name,
      email: person.email,
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
 * Update existing person (representative/owner)
 * @param {string} companyId - MongoDB company ID
 * @param {string} personId - Stripe person ID
 * @param {object} updates - Person information updates
 * @returns {object} Updated person details
 */
exports.updateAccountPerson = async (companyId, personId, updates) => {
  try {
    console.log(`Updating person ${personId} for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Update person in Stripe (pass through Stripe format directly)
    const person = await stripe.accounts.updatePerson(
      accountRecord.stripeAccountId,
      personId,
      updates
    );

    console.log(`Person updated in Stripe: ${person.id}`);

    // Update minimal info in database
    const dbUpdates = {};
    if (updates.first_name) dbUpdates["persons.$.first_name"] = updates.first_name;
    if (updates.last_name) dbUpdates["persons.$.last_name"] = updates.last_name;
    if (updates.email) dbUpdates["persons.$.email"] = updates.email;

    // Update verification status from Stripe
    if (person.verification) {
      dbUpdates["persons.$.verification.status"] = person.verification.status;
    }

    if (Object.keys(dbUpdates).length > 0) {
      await updateAccount(
        { _id: accountRecord._id, "persons.personId": personId },
        { $set: dbUpdates }
      );
    }

    console.log(`Person updated in database record`);

    return {
      success: true,
      personId: person.id,
      verificationStatus: person.verification?.status,
    };
  } catch (error) {
    console.error("Error updating person:", error);
    throw new Error(`Failed to update person: ${error.message}`);
  }
};

/**
 * Set attestation that all persons of a type have been provided
 * This tells Stripe you've finished adding all directors, executives, or owners
 * @param {string} companyId - MongoDB company ID
 * @param {object} attestations - { directors_provided, executives_provided, owners_provided }
 * @returns {object} Update result
 */
exports.setPersonsProvided = async (companyId, attestations) => {
  try {
    console.log(`Setting persons provided flags for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Build company updates object
    const updates = { company: {} };

    if (attestations.directors_provided !== undefined) {
      updates.company.directors_provided = attestations.directors_provided;
      console.log(`Setting directors_provided: ${attestations.directors_provided}`);
    }

    if (attestations.executives_provided !== undefined) {
      updates.company.executives_provided = attestations.executives_provided;
      console.log(`Setting executives_provided: ${attestations.executives_provided}`);
    }

    if (attestations.owners_provided !== undefined) {
      updates.company.owners_provided = attestations.owners_provided;
      console.log(`Setting owners_provided: ${attestations.owners_provided}`);
    }

    // Update in Stripe
    const updatedAccount = await stripe.accounts.update(
      accountRecord.stripeAccountId,
      updates
    );

    console.log(`Persons provided flags set successfully`);

    return {
      success: true,
      accountId: updatedAccount.id,
      attestations: {
        directors_provided: updates.company.directors_provided,
        executives_provided: updates.company.executives_provided,
        owners_provided: updates.company.owners_provided,
      },
    };
  } catch (error) {
    console.error("Error setting persons provided:", error);
    throw new Error(`Failed to set persons provided: ${error.message}`);
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
 * Get Stripe account by ID
 * @param {string} stripeAccountId - Stripe account ID
 * @returns {object} Stripe account object
 */
exports.getAccount = async (stripeAccountId) => {
  try {
    return await stripe.accounts.retrieve(stripeAccountId);
  } catch (error) {
    console.error("Error retrieving account:", error);
    throw new Error(`Failed to retrieve account: ${error.message}`);
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
      "capabilities.issuing": stripeAccount.capabilities?.card_issuing || "inactive",
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

    // Calculate onboarding progress
    const currentlyDue = stripeAccount.requirements?.currently_due || [];
    const eventuallyDue = stripeAccount.requirements?.eventually_due || [];
    const pastDue = stripeAccount.requirements?.past_due || [];

    // Total requirements = currently_due + eventually_due (unique)
    const allRequirements = [...new Set([...currentlyDue, ...eventuallyDue])];
    const totalRequirements = allRequirements.length;
    const remainingRequirements = currentlyDue.length;

    // Helper fields: Deduplicate requirements for frontend convenience
    const uniqueFields = [...new Set(eventuallyDue)]; // Unique fields from eventuallyDue
    const totalUniqueCount = uniqueFields.length;
    const currentCount = currentlyDue.length;
    const overdueCount = pastDue.length;

    // Calculate progress percentage
    let progressPercentage = 0;
    if (totalRequirements > 0) {
      const completedRequirements = totalRequirements - remainingRequirements;
      progressPercentage = Math.round((completedRequirements / totalRequirements) * 100);
    } else if (onboardingComplete) {
      progressPercentage = 100;
    }

    // Group requirements by category for better UX
    const requirementCategories = {
      businessInfo: currentlyDue.filter(r => r.startsWith('business_profile.') || r.startsWith('company.')),
      representatives: currentlyDue.filter(r => r.includes('owners_provided') || r.startsWith('person.')),
      bankAccount: currentlyDue.filter(r => r.includes('external_account')),
      verification: currentlyDue.filter(r => r.includes('verification.document')),
      terms: currentlyDue.filter(r => r.includes('tos_acceptance')),
      other: currentlyDue.filter(r =>
        !r.startsWith('business_profile.') &&
        !r.startsWith('company.') &&
        !r.includes('owners_provided') &&
        !r.startsWith('person.') &&
        !r.includes('external_account') &&
        !r.includes('verification.document') &&
        !r.includes('tos_acceptance')
      ),
    };

    return {
      success: true,
      accountId: accountRecord.stripeAccountId,
      chargesEnabled: stripeAccount.charges_enabled,
      payoutsEnabled: stripeAccount.payouts_enabled,
      onboardingComplete,
      detailsSubmitted: stripeAccount.details_submitted,

      // Progress tracking
      progress: {
        percentage: progressPercentage,
        totalRequirements,
        remainingRequirements,
        completedRequirements: totalRequirements - remainingRequirements,
      },

      capabilities: {
        cardPayments: stripeAccount.capabilities?.card_payments || "inactive",
        transfers: stripeAccount.capabilities?.transfers || "inactive",
        issuing: stripeAccount.capabilities?.card_issuing || "inactive",
      },
      requirements: {
        currentlyDue: currentlyDue,
        eventuallyDue: eventuallyDue,
        pastDue: pastDue,
        disabledReason: stripeAccount.requirements?.disabled_reason || null,
        currentDeadline: stripeAccount.requirements?.current_deadline || null,
        categories: requirementCategories,

        // Helper fields for frontend (deduplicated)
        uniqueFields: uniqueFields,
        totalUniqueCount: totalUniqueCount,
        currentCount: currentCount,
        overdueCount: overdueCount,
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
        updates["capabilities.issuing"] = stripeAccount.capabilities.card_issuing || "inactive";
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

/**
 * Convert snake_case to Title Case
 * @param {string} str - Snake case string (e.g., "tax_id")
 * @returns {string} Title case string (e.g., "Tax Id")
 */
function toTitleCase(str) {
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Dynamically generate human-readable label from Stripe requirement field path
 * @param {string} fieldPath - Stripe field path (e.g., "company.tax_id")
 * @returns {object} { label, description, category }
 */
function getRequirementLabel(fieldPath) {
  // Small override map for special cases that need custom wording
  const overrideMap = {
    "external_account": {
      label: "Add Bank Account",
      description: "Bank account for receiving payouts"
    },
    "company.owners_provided": {
      label: "Provide Account Representative",
      description: "Add at least one owner or representative for the business"
    },
    "tos_acceptance.date": {
      label: "Accept Terms of Service",
      description: "Accept Stripe's terms of service"
    },
    "tos_acceptance.ip": {
      label: "Accept Terms of Service",
      description: "Accept Stripe's terms of service"
    },
    "business_profile.url": {
      label: "Provide Business Website",
      description: "URL of the business website"
    },
    "business_profile.mcc": {
      label: "Provide Merchant Category Code",
      description: "MCC code representing your business type"
    },
    "company.name": {
      label: "Provide Legal Business Name",
      description: "Official registered name of the business"
    },
  };

  // Check override map first
  if (overrideMap[fieldPath]) {
    const override = overrideMap[fieldPath];
    return {
      label: override.label,
      description: override.description,
      category: getCategoryFromPath(fieldPath)
    };
  }

  // Dynamic label generation
  const parts = fieldPath.split('.');
  const lastPart = parts[parts.length - 1];
  const fieldName = toTitleCase(lastPart);

  // Determine action word based on field type
  let actionWord = "Provide";
  if (fieldPath.includes("verification.document") || fieldPath.includes(".document")) {
    actionWord = "Upload";
  } else if (fieldPath.includes("tos_acceptance")) {
    actionWord = "Accept";
  } else if (fieldPath === "external_account") {
    actionWord = "Add";
  }

  // Generate label with context based on path prefix
  let label;
  let description;

  if (fieldPath.startsWith("person.")) {
    const contextField = toTitleCase(lastPart);
    label = `${actionWord} Representative ${contextField}`;
    description = `${contextField} of business representative`;
  } else if (fieldPath.startsWith("individual.")) {
    const contextField = toTitleCase(lastPart);
    label = `${actionWord} Your ${contextField}`;
    description = `Your ${contextField.toLowerCase()}`;
  } else if (fieldPath.startsWith("company.")) {
    const contextField = toTitleCase(lastPart);
    label = `${actionWord} Company ${contextField}`;
    description = `Company ${contextField.toLowerCase()}`;
  } else if (fieldPath.startsWith("business_profile.")) {
    const contextField = toTitleCase(lastPart);
    label = `${actionWord} ${contextField}`;
    description = `Business ${contextField.toLowerCase()}`;
  } else {
    // Generic fallback
    label = `${actionWord} ${fieldName}`;
    description = `Required: ${fieldName}`;
  }

  return {
    label,
    description,
    category: getCategoryFromPath(fieldPath)
  };
}

/**
 * Determine category from field path
 * @param {string} fieldPath - Stripe field path
 * @returns {string} Category name
 */
function getCategoryFromPath(fieldPath) {
  if (fieldPath.startsWith("person.") || fieldPath.includes("owners_provided")) {
    return "representatives";
  }
  if (fieldPath.includes("external_account") || fieldPath.includes("bank")) {
    return "bankAccount";
  }
  if (fieldPath.includes("verification.document") || fieldPath.includes(".document")) {
    return "verification";
  }
  if (fieldPath.includes("tos_acceptance")) {
    return "terms";
  }
  if (fieldPath.startsWith("company.") || fieldPath.startsWith("business_profile.") || fieldPath.startsWith("individual.")) {
    return "businessInfo";
  }
  return "other";
}

/**
 * Get requirements list with human-readable labels
 * @param {string} companyId - MongoDB company ID
 * @param {string} status - 'active' or 'completed'
 * @returns {object} Requirements list
 */
exports.getRequirementsList = async (companyId, status) => {
  try {
    console.log(`Fetching ${status} requirements for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Fetch fresh account data from Stripe
    const stripeAccount = await stripe.accounts.retrieve(accountRecord.stripeAccountId);

    const currentlyDue = stripeAccount.requirements?.currently_due || [];
    const eventuallyDue = stripeAccount.requirements?.eventually_due || [];
    const pastDue = stripeAccount.requirements?.past_due || [];

    // Get all unique requirements
    const allUniqueRequirements = [...new Set(eventuallyDue)];

    // Separate active (pending) and completed requirements
    const activeRequirements = currentlyDue;
    const completedRequirementFields = allUniqueRequirements.filter(
      field => !currentlyDue.includes(field)
    );

    let requirementsList = [];

    if (status === "active") {
      // Return pending requirements
      requirementsList = activeRequirements.map(fieldPath => {
        const labelInfo = getRequirementLabel(fieldPath);
        return {
          field: fieldPath,
          label: labelInfo.label,
          description: labelInfo.description,
          category: labelInfo.category,
          completed: false,
          overdue: pastDue.includes(fieldPath)
        };
      });
    } else if (status === "completed") {
      // Return completed requirements
      requirementsList = completedRequirementFields.map(fieldPath => {
        const labelInfo = getRequirementLabel(fieldPath);
        return {
          field: fieldPath,
          label: labelInfo.label,
          description: labelInfo.description,
          category: labelInfo.category,
          completed: true,
          overdue: false
        };
      });
    } else {
      throw new Error("Invalid status parameter. Must be 'active' or 'completed'");
    }

    // Calculate progress
    const totalRequirements = allUniqueRequirements.length;
    const completedCount = completedRequirementFields.length;
    const remainingCount = activeRequirements.length;
    const progressPercentage = totalRequirements > 0
      ? Math.round((completedCount / totalRequirements) * 100)
      : 0;

    console.log(`Progress: ${progressPercentage}% (${completedCount}/${totalRequirements})`);

    return {
      success: true,
      status,
      count: requirementsList.length,
      progress: {
        percentage: progressPercentage,
        completed: completedCount,
        total: totalRequirements,
        remaining: remainingCount
      },
      requirements: requirementsList
    };
  } catch (error) {
    console.error("Error fetching requirements list:", error);
    throw new Error(`Failed to fetch requirements list: ${error.message}`);
  }
};

/**
 * Upload branding file (logo or icon) to Stripe
 * @param {string} companyId - MongoDB company ID
 * @param {object} file - Multer file object with buffer
 * @param {string} purpose - 'business_logo' or 'business_icon'
 * @returns {object} File upload result with file ID
 */
exports.uploadBrandingFile = async (companyId, file, purpose) => {
  try {
    console.log(`Uploading branding file: ${file.originalname}, purpose: ${purpose}`);

    // Validate purpose
    const validPurposes = ["business_logo", "business_icon"];
    if (!validPurposes.includes(purpose)) {
      throw new Error(`Invalid purpose. Must be one of: ${validPurposes.join(", ")}`);
    }

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Create file upload to Stripe (Upload to platform account - can be used by all connected accounts)
    const fileUpload = await stripe.files.create({
      file: {
        data: file.buffer,
        name: file.originalname,
        type: file.mimetype,
      },
      purpose: purpose,
    });

    console.log(`File uploaded successfully to platform (for account ${accountRecord.stripeAccountId}): ${fileUpload.id}`);

    return {
      success: true,
      fileId: fileUpload.id,
      filename: fileUpload.filename,
      url: fileUpload.url,
      size: fileUpload.size,
      purpose: fileUpload.purpose,
    };
  } catch (error) {
    console.error("Error uploading branding file:", error);
    throw new Error(`Failed to upload branding file: ${error.message}`);
  }
};

/**
 * Update branding settings for Connect account
 * @param {string} companyId - MongoDB company ID
 * @param {object} brandingData - { icon, logo, primary_color, secondary_color }
 * @returns {object} Update result
 */
exports.updateBrandingSettings = async (companyId, brandingData) => {
  try {
    console.log(`Updating branding settings for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Build branding updates
    const brandingUpdates = {};

    if (brandingData.icon !== undefined) {
      brandingUpdates.icon = brandingData.icon;
    }

    if (brandingData.logo !== undefined) {
      brandingUpdates.logo = brandingData.logo;
    }

    if (brandingData.primary_color !== undefined) {
      brandingUpdates.primary_color = brandingData.primary_color;
    }

    if (brandingData.secondary_color !== undefined) {
      brandingUpdates.secondary_color = brandingData.secondary_color;
    }

    // Update account in Stripe
    const updatedAccount = await stripe.accounts.update(
      accountRecord.stripeAccountId,
      {
        settings: {
          branding: brandingUpdates,
        },
      }
    );

    console.log(`Branding settings updated successfully for account: ${accountRecord.stripeAccountId}`);

    return {
      success: true,
      accountId: updatedAccount.id,
      branding: updatedAccount.settings?.branding || {},
    };
  } catch (error) {
    console.error("Error updating branding settings:", error);
    throw new Error(`Failed to update branding settings: ${error.message}`);
  }
};

/**
 * Get current branding settings for Connect account
 * @param {string} companyId - MongoDB company ID
 * @returns {object} Branding settings
 */
exports.getBrandingSettings = async (companyId) => {
  try {
    console.log(`Fetching branding settings for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Fetch account from Stripe
    const stripeAccount = await stripe.accounts.retrieve(accountRecord.stripeAccountId);

    const branding = stripeAccount.settings?.branding || {};

    // Fetch file URLs if file IDs exist
    const brandingWithUrls = { ...branding };

    if (branding.icon) {
      try {
        const iconFile = await stripe.files.retrieve(branding.icon);
        brandingWithUrls.icon_url = iconFile.url;
        brandingWithUrls.icon_filename = iconFile.filename;
      } catch (err) {
        console.error("Error fetching icon file:", err.message);
      }
    }

    if (branding.logo) {
      try {
        const logoFile = await stripe.files.retrieve(branding.logo);
        brandingWithUrls.logo_url = logoFile.url;
        brandingWithUrls.logo_filename = logoFile.filename;
      } catch (err) {
        console.error("Error fetching logo file:", err.message);
      }
    }

    return {
      success: true,
      accountId: stripeAccount.id,
      branding: brandingWithUrls,
    };
  } catch (error) {
    console.error("Error fetching branding settings:", error);
    throw new Error(`Failed to fetch branding settings: ${error.message}`);
  }
};

/**
 * Remove branding asset (icon or logo) from Connect account
 * @param {string} companyId - MongoDB company ID
 * @param {string} assetType - 'icon' or 'logo'
 * @returns {object} Update result
 */
exports.removeBrandingAsset = async (companyId, assetType) => {
  try {
    console.log(`Removing branding ${assetType} for company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Validate asset type
    if (!["icon", "logo"].includes(assetType)) {
      throw new Error("Invalid asset type. Must be 'icon' or 'logo'");
    }

    // Update account in Stripe (set to null to remove)
    const brandingUpdates = {};
    brandingUpdates[assetType] = null;

    const updatedAccount = await stripe.accounts.update(
      accountRecord.stripeAccountId,
      {
        settings: {
          branding: brandingUpdates,
        },
      }
    );

    console.log(`Branding ${assetType} removed successfully`);

    return {
      success: true,
      accountId: updatedAccount.id,
      removed: assetType,
      branding: updatedAccount.settings?.branding || {},
    };
  } catch (error) {
    console.error(`Error removing branding ${assetType}:`, error);
    throw new Error(`Failed to remove branding ${assetType}: ${error.message}`);
  }
};

/**
 * Get list of all Stripe-supported countries with specifications
 * @returns {object} List of country specs
 */
exports.getCountrySpecs = async () => {
  try {
    console.log("Fetching country specs from Stripe");

    // Fetch all country specs from Stripe (max 100 per request)
    const countrySpecs = await stripe.countrySpecs.list({
      limit: 100,
    });

    // Format the response for frontend consumption
    const countries = countrySpecs.data.map((spec) => ({
      code: spec.id,
      default_currency: spec.default_currency,
      supported_payment_currencies: spec.supported_payment_currencies || [],
      supported_payment_methods: spec.supported_payment_methods || [],
      supported_bank_account_currencies: spec.supported_bank_account_currencies || {},
      supported_transfer_countries: spec.supported_transfer_countries || [],
    }));

    console.log(`Retrieved ${countries.length} country specs`);

    return {
      success: true,
      countries: countries,
    };
  } catch (error) {
    console.error("Error fetching country specs:", error);
    throw new Error(`Failed to fetch country specs: ${error.message}`);
  }
};

// ==================== Client Payment Methods ====================

/**
 * Create Stripe customer for client on connected account
 * @param {string} companyId - MongoDB company ID
 * @param {object} clientData - { name, email, phone }
 * @returns {object} Customer creation result
 */
exports.createClientCustomer = async (companyId, clientData) => {
  try {
    console.log(`Creating Stripe customer for client on company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Validate account is ready to collect payments
    // Fetch latest account status from Stripe
    const stripeAccount = await stripe.accounts.retrieve(accountRecord.stripeAccountId);

    // Check if account can accept payments
    if (!stripeAccount.charges_enabled) {
      throw new Error(
        "Stripe account is not verified. Please complete account setup before collecting payment methods."
      );
    }

    // Check if there are pending requirements
    if (
      stripeAccount.requirements?.currently_due &&
      stripeAccount.requirements.currently_due.length > 0
    ) {
      throw new Error(
        `Stripe account has pending requirements: ${stripeAccount.requirements.currently_due.join(", ")}. Please complete account setup first.`
      );
    }

    // Create customer on connected account
    const customer = await stripe.customers.create(
      {
        name: clientData.name,
        email: clientData.email,
        phone: clientData.phone,
        metadata: {
          source: "boardd_client_management",
          companyId: companyId,
        },
      },
      {
        stripeAccount: accountRecord.stripeAccountId,
      }
    );

    console.log(`Customer created on connected account: ${customer.id}`);

    return {
      success: true,
      customerId: customer.id,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
    };
  } catch (error) {
    console.error("Error creating client customer:", error);
    throw new Error(`Failed to create customer: ${error.message}`);
  }
};

/**
 * Update customer address for tax calculation
 * @param {string} companyId - MongoDB company ID
 * @param {string} customerId - Stripe customer ID
 * @param {object} address - Customer address { line1, line2, city, state, postal_code, country }
 * @returns {object} Updated customer
 */
exports.updateCustomerAddress = async (companyId, customerId, address) => {
  try {
    console.log(`Updating customer address for ${customerId} on company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Update customer with address
    const customer = await stripe.customers.update(
      customerId,
      {
        address: {
          line1: address.line1 || undefined,
          line2: address.line2 || undefined,
          city: address.city || undefined,
          state: address.state || undefined,
          postal_code: address.postal_code,
          country: address.country
        },
        tax: {
          validate_location: 'immediately' // Validate location immediately for tax calculation
        }
      },
      {
        stripeAccount: accountRecord.stripeAccountId,
      }
    );

    console.log(`Customer address updated: ${customer.id}`);

    return {
      success: true,
      customerId: customer.id,
      address: customer.address
    };
  } catch (error) {
    console.error("Error updating customer address:", error);
    throw new Error(`Failed to update customer address: ${error.message}`);
  }
};

/**
 * Get customer details
 * @param {object} params - { customerId, connectedAccountId }
 * @returns {object} Customer object
 */
exports.getCustomer = async (params) => {
  try {
    const { customerId, connectedAccountId } = params;

    console.log(`Retrieving customer: ${customerId}`);

    const customer = await stripe.customers.retrieve(
      customerId,
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      success: true,
      customer
    };
  } catch (error) {
    console.error("Error retrieving customer:", error);
    throw new Error(`Failed to retrieve customer: ${error.message}`);
  }
};

/**
 * Create SetupIntent for collecting payment method without charging
 * @param {string} companyId - MongoDB company ID
 * @param {string} customerId - Stripe customer ID
 * @param {array} paymentMethodTypes - Payment method types to enable ['card', 'us_bank_account']
 * @returns {object} SetupIntent with client_secret
 */
exports.createClientSetupIntent = async (companyId, customerId, paymentMethodTypes = ['card']) => {
  try {
    console.log(`Creating SetupIntent for customer ${customerId} on company: ${companyId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Validate account is ready
    const stripeAccount = await stripe.accounts.retrieve(accountRecord.stripeAccountId);

    if (!stripeAccount.charges_enabled) {
      throw new Error(
        "Stripe account is not verified. Please complete account setup before collecting payment methods."
      );
    }

    // Check if there are pending requirements
    if (
      stripeAccount.requirements?.currently_due &&
      stripeAccount.requirements.currently_due.length > 0
    ) {
      throw new Error(
        `Stripe account has pending requirements: ${stripeAccount.requirements.currently_due.join(", ")}. Please complete account setup first.`
      );
    }

    // Build SetupIntent configuration
    const setupIntentConfig = {
      customer: customerId,
      payment_method_types: paymentMethodTypes,
      usage: "off_session", // For future charges when customer not present
      metadata: {
        companyId: companyId,
        source: "boardd_client_management",
      },
    };

    // Add payment method options for ACH Direct Debit
    if (paymentMethodTypes.includes('us_bank_account')) {
      setupIntentConfig.payment_method_options = {
        us_bank_account: {
          financial_connections: {
            permissions: ['payment_method', 'balances']
          },
          verification_method: 'instant' // Instant verification via Stripe Financial Connections
        }
      };
    }

    // Create SetupIntent for payment method collection
    const setupIntent = await stripe.setupIntents.create(
      setupIntentConfig,
      {
        stripeAccount: accountRecord.stripeAccountId,
      }
    );

    console.log(`SetupIntent created: ${setupIntent.id}`);

    return {
      success: true,
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
      status: setupIntent.status,
    };
  } catch (error) {
    console.error("Error creating SetupIntent:", error);
    throw new Error(`Failed to create SetupIntent: ${error.message}`);
  }
};

/**
 * Retrieve payment method details after successful SetupIntent
 * Returns non-sensitive card data for database storage
 * @param {string} companyId - MongoDB company ID
 * @param {string} setupIntentId - Stripe SetupIntent ID
 * @returns {object} Payment method details
 */
exports.retrievePaymentMethodDetails = async (companyId, setupIntentId) => {
  try {
    console.log(`Retrieving payment method from SetupIntent: ${setupIntentId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Retrieve SetupIntent to get payment method ID
    const setupIntent = await stripe.setupIntents.retrieve(
      setupIntentId,
      {},
      {
        stripeAccount: accountRecord.stripeAccountId,
      }
    );

    if (setupIntent.status !== "succeeded") {
      throw new Error(
        `SetupIntent has not succeeded. Current status: ${setupIntent.status}`
      );
    }

    if (!setupIntent.payment_method) {
      throw new Error("No payment method attached to this SetupIntent");
    }

    // Retrieve payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(
      setupIntent.payment_method,
      {},
      {
        stripeAccount: accountRecord.stripeAccountId,
      }
    );

    // Extract non-sensitive card details for database storage
    const cardDetails = {
      paymentMethodId: paymentMethod.id,
      type: paymentMethod.type, // 'card'
      card: {
        brand: paymentMethod.card?.brand, // 'visa', 'mastercard', 'amex', etc.
        last4: paymentMethod.card?.last4, // Last 4 digits
        expMonth: paymentMethod.card?.exp_month, // 1-12
        expYear: paymentMethod.card?.exp_year, // 2025, 2026, etc.
        funding: paymentMethod.card?.funding, // 'credit', 'debit', 'prepaid'
      },
    };

    console.log(`Payment method retrieved: ${paymentMethod.id} (${cardDetails.card.brand} **** ${cardDetails.card.last4})`);

    return {
      success: true,
      paymentMethod: cardDetails,
    };
  } catch (error) {
    console.error("Error retrieving payment method details:", error);
    throw new Error(`Failed to retrieve payment method: ${error.message}`);
  }
};

/**
 * List all payment methods for a customer
 * @param {string} companyId - MongoDB company ID
 * @param {string} customerId - Stripe customer ID
 * @returns {object} List of payment methods
 */
exports.listClientPaymentMethods = async (companyId, customerId) => {
  try {
    console.log(`Listing payment methods for customer: ${customerId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // List payment methods for customer
    const paymentMethods = await stripe.paymentMethods.list(
      {
        customer: customerId,
        type: "card",
      },
      {
        stripeAccount: accountRecord.stripeAccountId,
      }
    );

    // Format payment methods
    const formattedMethods = paymentMethods.data.map((pm) => ({
      paymentMethodId: pm.id,
      type: pm.type,
      card: {
        brand: pm.card?.brand,
        last4: pm.card?.last4,
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year,
        funding: pm.card?.funding,
      },
    }));

    console.log(`Found ${formattedMethods.length} payment methods`);

    return {
      success: true,
      paymentMethods: formattedMethods,
      count: formattedMethods.length,
    };
  } catch (error) {
    console.error("Error listing payment methods:", error);
    throw new Error(`Failed to list payment methods: ${error.message}`);
  }
};

/**
 * Detach payment method from customer (remove card)
 * @param {string} companyId - MongoDB company ID
 * @param {string} paymentMethodId - Stripe payment method ID
 * @returns {object} Detach result
 */
exports.detachPaymentMethod = async (companyId, paymentMethodId) => {
  try {
    console.log(`Detaching payment method: ${paymentMethodId}`);

    // Find account
    const accountRecord = await findAccountByCompany(companyId);
    if (!accountRecord) {
      throw new Error("Stripe account not found for this company");
    }

    // Detach payment method from customer
    const paymentMethod = await stripe.paymentMethods.detach(
      paymentMethodId,
      {},
      {
        stripeAccount: accountRecord.stripeAccountId,
      }
    );

    console.log(`Payment method detached: ${paymentMethod.id}`);

    return {
      success: true,
      paymentMethodId: paymentMethod.id,
      detached: true,
    };
  } catch (error) {
    console.error("Error detaching payment method:", error);
    throw new Error(`Failed to detach payment method: ${error.message}`);
  }
};

// ==================== Invoice Operations ====================

/**
 * Create draft invoice on connected account
 * @param {object} params - Invoice creation parameters
 * @param {string} params.customerId - Stripe customer ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {string} params.collectionMethod - 'charge_automatically' or 'send_invoice'
 * @param {number} params.daysUntilDue - Days until invoice is due (for send_invoice)
 * @param {Date} params.dueDate - Specific due date (alternative to daysUntilDue)
 * @param {string} params.description - Invoice description/memo
 * @param {string} params.footer - Invoice footer text
 * @param {string} params.currency - Currency code (default: 'usd')
 * @param {boolean} params.enableAutomaticTax - Enable Stripe Tax
 * @param {string} params.defaultPaymentMethod - Payment method ID to use
 * @returns {object} Created invoice
 */
exports.createInvoice = async (params) => {
  try {
    const {
      customerId,
      connectedAccountId,
      collectionMethod = 'send_invoice',
      daysUntilDue,
      dueDate,
      description,
      footer,
      currency = 'usd',
      enableAutomaticTax = true,
      defaultPaymentMethod,
      paymentMethods = ['card'],
      platformFee
    } = params;

    console.log(`Creating invoice for customer: ${customerId}`);

    // Build invoice creation request
    const invoiceData = {
      customer: customerId,
      collection_method: collectionMethod,
      currency,
      auto_advance: false, // Don't auto-finalize - user controls when to send
    };

    // Configure payment methods
    if (paymentMethods && paymentMethods.length > 0) {
      invoiceData.payment_settings = {
        payment_method_types: paymentMethods,
        payment_method_options: {}
      };

      // Add ACH Direct Debit configuration if included
      if (paymentMethods.includes('us_bank_account')) {
        invoiceData.payment_settings.payment_method_options.us_bank_account = {
          financial_connections: {
            permissions: ['payment_method', 'balances']
          },
          verification_method: 'instant'
        };
      }
    }

    // Add description and footer if provided
    if (description) invoiceData.description = description;
    if (footer) invoiceData.footer = footer;

    // Add due date settings (only for send_invoice)
    if (collectionMethod === 'send_invoice') {
      if (dueDate) {
        invoiceData.due_date = Math.floor(new Date(dueDate).getTime() / 1000);
      } else if (daysUntilDue) {
        invoiceData.days_until_due = daysUntilDue;
      }
    }

    // Add default payment method if provided
    if (defaultPaymentMethod) {
      invoiceData.default_payment_method = defaultPaymentMethod;
    }

    // Enable automatic tax calculation
    if (enableAutomaticTax) {
      invoiceData.automatic_tax = {
        enabled: true,
        liability: {
          type: 'self' // Tax liability is on the connected account itself
        }
      };
    }

    // Add platform fee (application fee)
    // Note: Will be calculated after line items are added
    // Store platformFee config for later use
    const platformFeeConfig = platformFee;

    // Create invoice
    const invoice = await stripe.invoices.create(
      invoiceData,
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Invoice created: ${invoice.id}`);

    return {
      success: true,
      invoice: {
        id: invoice.id,
        status: invoice.status,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        dueDate: invoice.due_date,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf
      },
      platformFeeConfig // Return platform fee config for controller to use
    };
  } catch (error) {
    console.error("Error creating invoice:", error);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }
};

/**
 * Add line items to draft invoice
 * @param {object} params - Line items parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {Array} params.lineItems - Array of line items
 * @returns {object} Updated invoice
 */
exports.addInvoiceLineItems = async (params) => {
  try {
    const { invoiceId, connectedAccountId, lineItems } = params;

    console.log(`Adding ${lineItems.length} line items to invoice: ${invoiceId}`);

    // Format line items for Stripe
    const formattedLineItems = lineItems.map(item => ({
      description: item.description,
      quantity: item.quantity,
      price_data: {
        currency: item.currency || 'usd',
        unit_amount: item.unitAmount, // Price per unit in cents
        product_data: {
          name: item.description // Use line item description as product name
        }
      }
    }));

    // Add line items using bulk add API
    const invoice = await stripe.invoices.addLines(
      invoiceId,
      {
        lines: formattedLineItems
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Line items added to invoice: ${invoiceId}`);

    return {
      success: true,
      invoice: {
        id: invoice.id,
        status: invoice.status,
        amountDue: invoice.amount_due,
        lineItemsCount: invoice.lines.data.length
      }
    };
  } catch (error) {
    console.error("Error adding line items:", error);
    throw new Error(`Failed to add line items: ${error.message}`);
  }
};

/**
 * Apply platform fee to invoice
 * @param {object} params - Platform fee parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {object} params.platformFee - Platform fee configuration { type: 'percentage'|'fixed', value: number }
 * @param {number} params.invoiceAmount - Total invoice amount to calculate fee from
 * @returns {object} Updated invoice with application fee
 */
exports.applyPlatformFee = async (params) => {
  try {
    const { invoiceId, connectedAccountId, platformFee, invoiceAmount } = params;

    if (!platformFee) {
      return { success: true, feeAmount: 0 };
    }

    // Calculate platform fee amount
    let feeAmount;
    if (platformFee.type === 'percentage') {
      feeAmount = Math.round((invoiceAmount * platformFee.value) / 100);
    } else if (platformFee.type === 'fixed') {
      feeAmount = platformFee.value;
    } else {
      throw new Error('Invalid platform fee type');
    }

    console.log(`Applying platform fee: ${feeAmount} cents (${platformFee.type}: ${platformFee.value})`);

    // Update invoice with application fee
    const invoice = await stripe.invoices.update(
      invoiceId,
      {
        application_fee_amount: feeAmount
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      success: true,
      feeAmount,
      invoice: {
        id: invoice.id,
        amountDue: invoice.amount_due,
        applicationFeeAmount: invoice.application_fee_amount
      }
    };
  } catch (error) {
    console.error("Error applying platform fee:", error);
    throw new Error(`Failed to apply platform fee: ${error.message}`);
  }
};

/**
 * Finalize invoice (draft → open)
 * @param {object} params - Finalize parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {boolean} params.autoAdvance - Auto-send after finalization
 * @param {string} params.customerEmail - Optional custom email for invoice delivery
 * @returns {object} Finalized invoice
 */
exports.finalizeInvoice = async (params) => {
  try {
    const { invoiceId, connectedAccountId, autoAdvance = false, customerEmail } = params;

    console.log(`Finalizing invoice: ${invoiceId}`);

    // If custom billing email provided, update customer email before finalizing
    if (customerEmail) {
      console.log(`Updating customer email for invoice delivery: ${customerEmail}`);

      // Get invoice to find customer ID
      const invoiceData = await stripe.invoices.retrieve(
        invoiceId,
        {
          stripeAccount: connectedAccountId
        }
      );

      // Update customer email
      await stripe.customers.update(
        invoiceData.customer,
        {
          email: customerEmail
        },
        {
          stripeAccount: connectedAccountId
        }
      );
    }

    const invoice = await stripe.invoices.finalizeInvoice(
      invoiceId,
      {
        auto_advance: autoAdvance
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Invoice finalized: ${invoice.id}, status: ${invoice.status}`);

    return {
      success: true,
      invoice: {
        id: invoice.id,
        status: invoice.status,
        amountDue: invoice.amount_due,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf,
        number: invoice.number
      }
    };
  } catch (error) {
    console.error("Error finalizing invoice:", error);
    throw new Error(`Failed to finalize invoice: ${error.message}`);
  }
};

/**
 * Validate that connected account has required settings for sending invoice emails
 * @param {string} connectedAccountId - Stripe connected account ID
 * @returns {object} Validation result with account settings
 */
async function validateAccountEmailSettings(connectedAccountId) {
  try {
    const account = await stripe.accounts.retrieve(connectedAccountId);

    const hasDisplayName = account.settings?.dashboard?.display_name;
    const hasBusinessName = account.business_profile?.name;

    return {
      valid: !!(hasDisplayName || hasBusinessName),
      displayName: hasDisplayName,
      businessName: hasBusinessName,
      account: account
    };
  } catch (error) {
    console.error('Error validating account email settings:', error);
    throw new Error(`Failed to validate account settings: ${error.message}`);
  }
}

/**
 * Send invoice email to customer
 * Note: Customer email should be updated during finalizeInvoice, not here
 * @param {object} params - Send parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @returns {object} Sent invoice
 */
exports.sendInvoice = async (params) => {
  try {
    const { invoiceId, connectedAccountId } = params;

    console.log(`Sending invoice: ${invoiceId}`);

    // Validate account has email settings configured
    const validation = await validateAccountEmailSettings(connectedAccountId);

    if (!validation.valid) {
      console.warn(
        `Warning: Connected account ${connectedAccountId} missing email settings. ` +
        `Emails may not be delivered. Please configure business_profile.name or ` +
        `settings.dashboard.display_name in Stripe account settings.`
      );
    } else {
      console.log(`Account email settings verified - Display: ${validation.displayName}, Business: ${validation.businessName}`);
    }

    const invoice = await stripe.invoices.sendInvoice(
      invoiceId,
      {},
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Invoice sent: ${invoice.id}`);

    return {
      success: true,
      invoice: {
        id: invoice.id,
        status: invoice.status,
        hostedInvoiceUrl: invoice.hosted_invoice_url
      }
    };
  } catch (error) {
    console.error("Error sending invoice:", error);
    throw new Error(`Failed to send invoice: ${error.message}`);
  }
};

/**
 * Get payment method details for a paid invoice
 * @param {string} invoiceId - Stripe invoice ID
 * @param {string} connectedAccountId - Stripe connected account ID
 * @returns {object} Payment method details
 */
exports.getInvoicePaymentDetails = async (invoiceId, connectedAccountId) => {
  try {
    // Step 1: Retrieve invoice with payments (Stripe API 2025-03-31+)
    // Only expand to 3 levels to avoid 4-level limit
    const invoice = await stripe.invoices.retrieve(
      invoiceId,
      {
        expand: ['payments']
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Attempting to retrieve payment details for invoice: ${invoiceId}`);

    // Get first payment from payments array (most invoices have single payment)
    const payment = invoice.payments?.data?.[0]?.payment;

    if (!payment) {
      console.log(`No payment found in payments array for invoice: ${invoiceId}`);
      return null;
    }

    let paymentSource = null;
    let sourceType = null;

    // Step 2: Fetch payment details based on payment type
    if (payment.type === 'payment_intent' && payment.payment_intent) {
      // Get PaymentIntent ID (it's just a string at this point)
      const paymentIntentId = typeof payment.payment_intent === 'string'
        ? payment.payment_intent
        : payment.payment_intent.id;

      console.log(`Fetching PaymentIntent details: ${paymentIntentId}`);

      // Fetch PaymentIntent with payment_method expanded
      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        {
          expand: ['payment_method']
        },
        {
          stripeAccount: connectedAccountId
        }
      );

      if (paymentIntent.payment_method && typeof paymentIntent.payment_method === 'object') {
        paymentSource = paymentIntent.payment_method;
        sourceType = 'PaymentIntent';
        console.log(`Payment details found via PaymentIntent for invoice: ${invoiceId}`);
      }
    }
    else if (payment.type === 'charge' && payment.charge) {
      // Get Charge ID (it's just a string at this point)
      const chargeId = typeof payment.charge === 'string'
        ? payment.charge
        : payment.charge.id;

      console.log(`Fetching Charge details: ${chargeId}`);

      // Fetch Charge (payment_method_details are included by default)
      const charge = await stripe.charges.retrieve(
        chargeId,
        {},
        {
          stripeAccount: connectedAccountId
        }
      );

      if (charge.payment_method_details) {
        paymentSource = charge.payment_method_details;
        sourceType = 'Charge';
        console.log(`Payment details found via Charge for invoice: ${invoiceId}`);
      }
    }

    // No payment details available (e.g., manually marked as paid)
    if (!paymentSource) {
      console.log(`No payment details available for invoice: ${invoiceId}`);
      return null;
    }

    // Extract payment details based on type
    const paymentDetails = {
      type: paymentSource.type
    };

    // Card payment details
    if (paymentSource.type === 'card' && paymentSource.card) {
      paymentDetails.card = {
        brand: paymentSource.card.brand,
        last4: paymentSource.card.last4,
        expMonth: paymentSource.card.exp_month,
        expYear: paymentSource.card.exp_year,
        funding: paymentSource.card.funding,
        country: paymentSource.card.country
      };
    }

    // US Bank Account payment details
    if (paymentSource.type === 'us_bank_account' && paymentSource.us_bank_account) {
      paymentDetails.bankAccount = {
        bankName: paymentSource.us_bank_account.bank_name,
        last4: paymentSource.us_bank_account.last4,
        accountType: paymentSource.us_bank_account.account_type
      };
    }

    // Customer balance / bank transfer
    if (paymentSource.type === 'customer_balance') {
      paymentDetails.customerBalance = {
        type: 'bank_transfer'
      };
    }

    console.log(`Successfully extracted payment details from ${sourceType} for invoice: ${invoiceId}`);
    return paymentDetails;
  } catch (error) {
    console.error('Error fetching invoice payment details:', error);
    throw new Error(`Failed to fetch payment details: ${error.message}`);
  }
};

/**
 * Void invoice
 * @param {object} params - Void parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @returns {object} Voided invoice
 */
exports.voidInvoice = async (params) => {
  try {
    const { invoiceId, connectedAccountId } = params;

    console.log(`Voiding invoice: ${invoiceId}`);

    const invoice = await stripe.invoices.voidInvoice(
      invoiceId,
      {},
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Invoice voided: ${invoice.id}`);

    return {
      success: true,
      invoice: {
        id: invoice.id,
        status: invoice.status
      }
    };
  } catch (error) {
    console.error("Error voiding invoice:", error);
    throw new Error(`Failed to void invoice: ${error.message}`);
  }
};

/**
 * Update draft invoice
 * @param {object} params - Update parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {object} params.updates - Fields to update
 * @returns {object} Updated invoice
 */
exports.updateInvoice = async (params) => {
  try {
    const { invoiceId, connectedAccountId, updates } = params;

    console.log(`Updating invoice: ${invoiceId}`);

    const invoice = await stripe.invoices.update(
      invoiceId,
      updates,
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Invoice updated: ${invoice.id}`);

    return {
      success: true,
      invoice: {
        id: invoice.id,
        status: invoice.status,
        amountDue: invoice.amount_due
      }
    };
  } catch (error) {
    console.error("Error updating invoice:", error);
    throw new Error(`Failed to update invoice: ${error.message}`);
  }
};

/**
 * Delete draft invoice
 * @param {object} params - Delete parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @returns {object} Deletion result
 */
exports.deleteInvoice = async (params) => {
  try {
    const { invoiceId, connectedAccountId } = params;

    console.log(`Deleting invoice: ${invoiceId}`);

    const deleted = await stripe.invoices.del(
      invoiceId,
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Invoice deleted: ${invoiceId}`);

    return {
      success: true,
      deleted: deleted.deleted,
      invoiceId: deleted.id
    };
  } catch (error) {
    console.error("Error deleting invoice:", error);
    throw new Error(`Failed to delete invoice: ${error.message}`);
  }
};

/**
 * Get invoice details
 * @param {object} params - Retrieve parameters
 * @param {string} params.invoiceId - Stripe invoice ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @returns {object} Invoice details
 */
exports.getInvoice = async (params) => {
  try {
    const { invoiceId, connectedAccountId } = params;

    console.log(`Retrieving invoice: ${invoiceId}`);

    const invoice = await stripe.invoices.retrieve(
      invoiceId,
      {
        expand: ['lines']
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      success: true,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        amountRemaining: invoice.amount_remaining,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        currency: invoice.currency,
        created: invoice.created,
        dueDate: invoice.due_date,
        paidAt: invoice.status_transitions?.paid_at,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf,
        lineItems: invoice.lines.data.map(line => ({
          id: line.id,
          description: line.description,
          amount: line.amount,
          quantity: line.quantity,
          unitAmount: line.unit_amount,
          currency: line.currency
        }))
      }
    };
  } catch (error) {
    console.error("Error retrieving invoice:", error);
    throw new Error(`Failed to retrieve invoice: ${error.message}`);
  }
};

/**
 * List invoices for customer
 * @param {object} params - List parameters
 * @param {string} params.customerId - Stripe customer ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {string} params.status - Filter by status
 * @param {number} params.limit - Number of invoices to return
 * @returns {object} Invoice list
 */
exports.listInvoices = async (params) => {
  try {
    const {
      customerId,
      connectedAccountId,
      status,
      limit = 10
    } = params;

    console.log(`Listing invoices for customer: ${customerId}`);

    const queryParams = {
      customer: customerId,
      limit
    };

    if (status) {
      queryParams.status = status;
    }

    const invoices = await stripe.invoices.list(
      queryParams,
      {
        stripeAccount: connectedAccountId
      }
    );

    return {
      success: true,
      invoices: invoices.data.map(invoice => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
        created: invoice.created,
        dueDate: invoice.due_date,
        hostedInvoiceUrl: invoice.hosted_invoice_url
      })),
      hasMore: invoices.has_more
    };
  } catch (error) {
    console.error("Error listing invoices:", error);
    throw new Error(`Failed to list invoices: ${error.message}`);
  }
};

// ==================== Subscription Operations ====================

/**
 * Create subscription with recurring billing
 * @param {object} params - Subscription parameters
 * @param {string} params.customerId - Stripe customer ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {number} params.unitAmount - Price per billing period in cents
 * @param {string} params.currency - Currency code
 * @param {string} params.interval - 'day', 'week', 'month', or 'year'
 * @param {number} params.intervalCount - Billing every X intervals
 * @param {string} params.collectionMethod - Payment collection method
 * @param {Date} params.endDate - Subscription end date
 * @param {number} params.endAfterCycles - End after X billing cycles
 * @param {string} params.description - Subscription description
 * @param {string} params.defaultPaymentMethod - Payment method ID
 * @param {number} params.daysUntilDue - Days until invoice payment is due (only for send_invoice)
 * @returns {object} Created subscription
 */
exports.createSubscription = async (params) => {
  try {
    const {
      customerId,
      connectedAccountId,
      unitAmount,
      currency = 'usd',
      interval,
      intervalCount = 1,
      collectionMethod = 'charge_automatically',
      endDate,
      endAfterCycles,
      description,
      defaultPaymentMethod,
      paymentMethods = ['card'],
      platformFee,
      daysUntilDue
    } = params;

    console.log(`Creating subscription for customer: ${customerId}`);

    // Create Price for the subscription
    const price = await stripe.prices.create(
      {
        currency,
        unit_amount: unitAmount,
        recurring: {
          interval,
          interval_count: intervalCount
        },
        product_data: {
          name: description || 'Subscription'
        }
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    // Build subscription request
    const subscriptionData = {
      customer: customerId,
      items: [{ price: price.id }],
      collection_method: collectionMethod,
      expand: ['latest_invoice']
    };

    // Configure payment methods
    if (paymentMethods && paymentMethods.length > 0) {
      subscriptionData.payment_settings = {
        payment_method_types: paymentMethods,
        payment_method_options: {}
      };

      // Add ACH Direct Debit configuration if included
      if (paymentMethods.includes('us_bank_account')) {
        subscriptionData.payment_settings.payment_method_options.us_bank_account = {
          financial_connections: {
            permissions: ['payment_method', 'balances']
          },
          verification_method: 'instant'
        };
      }
    }

    // Add platform fee (application fee percentage for subscriptions)
    if (platformFee) {
      if (platformFee.type === 'percentage') {
        subscriptionData.application_fee_percent = platformFee.value;
      } else if (platformFee.type === 'fixed') {
        // For fixed fees on subscriptions, calculate percentage
        const feePercentage = (platformFee.value / unitAmount) * 100;
        subscriptionData.application_fee_percent = feePercentage;
      }
    }

    if (defaultPaymentMethod) {
      subscriptionData.default_payment_method = defaultPaymentMethod;
    }

    if (description) {
      subscriptionData.description = description;
    }

    // Add days_until_due for send_invoice (payment terms like Net 30)
    if (collectionMethod === 'send_invoice' && daysUntilDue) {
      subscriptionData.days_until_due = daysUntilDue;
    }

    // Add end conditions
    if (endDate) {
      subscriptionData.cancel_at = Math.floor(new Date(endDate).getTime() / 1000);
    } else if (endAfterCycles) {
      // Calculate cancellation timestamp based on billing cycles
      const now = Math.floor(Date.now() / 1000); // Current Unix timestamp
      const secondsPerDay = 86400;

      let daysToAdd = 0;
      switch (interval) {
        case 'day':
          daysToAdd = intervalCount * endAfterCycles;
          break;
        case 'week':
          daysToAdd = 7 * intervalCount * endAfterCycles;
          break;
        case 'month':
          daysToAdd = 30 * intervalCount * endAfterCycles; // Approximate
          break;
        case 'year':
          daysToAdd = 365 * intervalCount * endAfterCycles; // Approximate
          break;
      }

      subscriptionData.cancel_at = now + (daysToAdd * secondsPerDay);
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create(
      subscriptionData,
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Subscription created: ${subscription.id}`);

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAt: subscription.cancel_at,
        latestInvoiceId: subscription.latest_invoice?.id,
        priceId: price.id
      }
    };
  } catch (error) {
    console.error("Error creating subscription:", error);
    throw new Error(`Failed to create subscription: ${error.message}`);
  }
};

/**
 * Create subscription with line items (for recurring invoices)
 * @param {object} params - Subscription parameters
 * @param {string} params.customerId - Stripe customer ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {Array} params.lineItems - Array of line items [{description, quantity, unitAmount, currency}]
 * @param {string} params.currency - Currency code
 * @param {string} params.interval - 'day', 'week', 'month', or 'year'
 * @param {number} params.intervalCount - Billing every X intervals
 * @param {string} params.collectionMethod - Payment collection method
 * @param {Date} params.endDate - Subscription end date
 * @param {number} params.endAfterCycles - End after X billing cycles
 * @param {string} params.description - Subscription description
 * @param {string} params.defaultPaymentMethod - Payment method ID
 * @param {Array} params.paymentMethods - Allowed payment methods
 * @param {object} params.platformFee - Platform fee configuration
 * @param {number} params.daysUntilDue - Days until invoice payment is due (only for send_invoice)
 * @returns {object} Created subscription with first invoice
 */
exports.createSubscriptionWithLineItems = async (params) => {
  try {
    const {
      customerId,
      connectedAccountId,
      lineItems,
      currency = 'usd',
      interval,
      intervalCount = 1,
      collectionMethod = 'charge_automatically',
      endDate,
      endAfterCycles,
      description,
      defaultPaymentMethod,
      paymentMethods = ['card'],
      platformFee,
      daysUntilDue
    } = params;

    console.log(`Creating subscription with line items for customer: ${customerId}`);

    // Create a Price for each line item
    const subscriptionItems = [];
    let totalAmount = 0;

    for (const item of lineItems) {
      const itemAmount = item.unitAmount * item.quantity;
      totalAmount += itemAmount;

      const price = await stripe.prices.create(
        {
          currency: item.currency || currency,
          unit_amount: item.unitAmount,
          recurring: {
            interval,
            interval_count: intervalCount
          },
          product_data: {
            name: item.description
          }
        },
        {
          stripeAccount: connectedAccountId
        }
      );

      subscriptionItems.push({
        price: price.id,
        quantity: item.quantity
      });
    }

    // Build subscription request
    const subscriptionData = {
      customer: customerId,
      items: subscriptionItems,
      collection_method: collectionMethod,
      expand: ['latest_invoice.payment_intent']
    };

    // Configure payment methods
    if (paymentMethods && paymentMethods.length > 0) {
      subscriptionData.payment_settings = {
        payment_method_types: paymentMethods,
        payment_method_options: {}
      };

      // Add ACH Direct Debit configuration if included
      if (paymentMethods.includes('us_bank_account')) {
        subscriptionData.payment_settings.payment_method_options.us_bank_account = {
          financial_connections: {
            permissions: ['payment_method', 'balances']
          },
          verification_method: 'instant'
        };
      }
    }

    // Add platform fee (application fee percentage for subscriptions)
    if (platformFee) {
      if (platformFee.type === 'percentage') {
        subscriptionData.application_fee_percent = platformFee.value;
      } else if (platformFee.type === 'fixed') {
        // For fixed fees on subscriptions, calculate percentage based on total
        const feePercentage = (platformFee.value / totalAmount) * 100;
        subscriptionData.application_fee_percent = feePercentage;
      }
    }

    if (defaultPaymentMethod) {
      subscriptionData.default_payment_method = defaultPaymentMethod;
    }

    if (description) {
      subscriptionData.description = description;
    }

    // Add days_until_due for send_invoice (payment terms like Net 30)
    if (collectionMethod === 'send_invoice' && daysUntilDue) {
      subscriptionData.days_until_due = daysUntilDue;
    }

    // Add end conditions
    if (endDate) {
      subscriptionData.cancel_at = Math.floor(new Date(endDate).getTime() / 1000);
    } else if (endAfterCycles) {
      // Calculate cancellation timestamp based on billing cycles
      const now = Math.floor(Date.now() / 1000); // Current Unix timestamp
      const secondsPerDay = 86400;

      let daysToAdd = 0;
      switch (interval) {
        case 'day':
          daysToAdd = intervalCount * endAfterCycles;
          break;
        case 'week':
          daysToAdd = 7 * intervalCount * endAfterCycles;
          break;
        case 'month':
          daysToAdd = 30 * intervalCount * endAfterCycles; // Approximate
          break;
        case 'year':
          daysToAdd = 365 * intervalCount * endAfterCycles; // Approximate
          break;
      }

      subscriptionData.cancel_at = now + (daysToAdd * secondsPerDay);
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create(
      subscriptionData,
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Subscription created with line items: ${subscription.id}`);

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAt: subscription.cancel_at,
        latestInvoiceId: subscription.latest_invoice?.id || subscription.latest_invoice,
        latestInvoice: subscription.latest_invoice
      }
    };
  } catch (error) {
    console.error("Error creating subscription with line items:", error);
    throw new Error(`Failed to create subscription with line items: ${error.message}`);
  }
};

/**
 * Update subscription
 * @param {object} params - Update parameters
 * @param {string} params.subscriptionId - Stripe subscription ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {object} params.updates - Fields to update
 * @returns {object} Updated subscription
 */
exports.updateSubscription = async (params) => {
  try {
    const { subscriptionId, connectedAccountId, updates } = params;

    console.log(`Updating subscription: ${subscriptionId}`);

    const subscription = await stripe.subscriptions.update(
      subscriptionId,
      updates,
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Subscription updated: ${subscription.id}`);

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status
      }
    };
  } catch (error) {
    console.error("Error updating subscription:", error);
    throw new Error(`Failed to update subscription: ${error.message}`);
  }
};

/**
 * Cancel subscription
 * @param {object} params - Cancel parameters
 * @param {string} params.subscriptionId - Stripe subscription ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @param {boolean} params.cancelAtPeriodEnd - Cancel at end of billing period
 * @returns {object} Canceled subscription
 */
exports.cancelSubscription = async (params) => {
  try {
    const { subscriptionId, connectedAccountId, cancelAtPeriodEnd = false } = params;

    console.log(`Canceling subscription: ${subscriptionId}`);

    let subscription;
    if (cancelAtPeriodEnd) {
      // Cancel at period end
      subscription = await stripe.subscriptions.update(
        subscriptionId,
        {
          cancel_at_period_end: true
        },
        {
          stripeAccount: connectedAccountId
        }
      );
    } else {
      // Cancel immediately
      subscription = await stripe.subscriptions.cancel(
        subscriptionId,
        {},
        {
          stripeAccount: connectedAccountId
        }
      );
    }

    console.log(`Subscription canceled: ${subscription.id}`);

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        canceledAt: subscription.canceled_at,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      }
    };
  } catch (error) {
    console.error("Error canceling subscription:", error);
    throw new Error(`Failed to cancel subscription: ${error.message}`);
  }
};

/**
 * Pause subscription
 * @param {object} params - Pause parameters
 * @param {string} params.subscriptionId - Stripe subscription ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @returns {object} Paused subscription
 */
exports.pauseSubscription = async (params) => {
  try {
    const { subscriptionId, connectedAccountId } = params;

    console.log(`Pausing subscription: ${subscriptionId}`);

    const subscription = await stripe.subscriptions.update(
      subscriptionId,
      {
        pause_collection: {
          behavior: 'mark_uncollectible'
        }
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Subscription paused: ${subscription.id}`);

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        pauseCollection: subscription.pause_collection
      }
    };
  } catch (error) {
    console.error("Error pausing subscription:", error);
    throw new Error(`Failed to pause subscription: ${error.message}`);
  }
};

/**
 * Resume paused subscription
 * @param {object} params - Resume parameters
 * @param {string} params.subscriptionId - Stripe subscription ID
 * @param {string} params.connectedAccountId - Stripe connected account ID
 * @returns {object} Resumed subscription
 */
exports.resumeSubscription = async (params) => {
  try {
    const { subscriptionId, connectedAccountId } = params;

    console.log(`Resuming subscription: ${subscriptionId}`);

    const subscription = await stripe.subscriptions.update(
      subscriptionId,
      {
        pause_collection: ''
      },
      {
        stripeAccount: connectedAccountId
      }
    );

    console.log(`Subscription resumed: ${subscription.id}`);

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status
      }
    };
  } catch (error) {
    console.error("Error resuming subscription:", error);
    throw new Error(`Failed to resume subscription: ${error.message}`);
  }
};
