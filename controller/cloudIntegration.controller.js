"use strict";

const { google } = require("googleapis");
const { Dropbox, DropboxAuth } = require("dropbox");
const { STATUS_CODES } = require("../utils/constants");
const { generateResponse, parseBody } = require("../utils");
const { getRedis } = require("../utils/redis");
const {
  createIntegration,
  findIntegration,
  findIntegrationWithTokens,
  findUserIntegrations,
  updateIntegrationTokens,
  disconnectIntegration,
  CLOUD_PROVIDERS,
} = require("../models/cloudIntegrationModel");

// Google OAuth2 Client Setup
function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Dropbox OAuth2 Setup
function getDropboxAuth() {
  return {
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
  };
}

// Microsoft Graph OAuth2 Setup
function getMicrosoftOAuthConfig() {
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    redirectUri: process.env.MICROSOFT_REDIRECT_URI,
    authority: "https://login.microsoftonline.com/common",
    scopes: [
      "User.Read",
      "Files.Read.All",
      "offline_access", // Required for refresh tokens
    ],
  };
}

/**
 * Initiate Google Drive OAuth flow
 */
exports.initiateGoogleDriveAuth = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const oauth2Client = getGoogleOAuthClient();

    // Generate auth URL with offline access to get refresh token
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      state: userId, // Pass userId in state for callback
      prompt: "consent", // Force consent screen to get refresh token
    });

    // Return OAuth URL to frontend instead of redirecting
    return generateResponse(
      {
        authUrl,
        provider: "google_drive"
      },
      "Google Drive authorization URL generated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error initiating Google Drive auth:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Google Drive OAuth callback handler
 */
exports.googleDriveCallback = async (req, res, next) => {
  try {
    const { code, state: userId } = req.query;

    console.log(`[Google Drive Callback] Starting for userId: ${userId}`);

    if (!code || !userId) {
      console.error("[Google Drive Callback] Missing code or userId");
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Missing authorization code or user ID",
      });
    }

    const oauth2Client = getGoogleOAuthClient();

    // Exchange code for tokens
    console.log("[Google Drive Callback] Exchanging code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    console.log("[Google Drive Callback] ✓ Token exchange successful");
    console.log(`  - Has access_token: ${!!tokens.access_token}`);
    console.log(`  - Has refresh_token: ${!!tokens.refresh_token}`);
    console.log(`  - Expiry date: ${new Date(tokens.expiry_date).toISOString()}`);

    // Get user info from Google
    console.log("[Google Drive Callback] Fetching user info...");
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    console.log("[Google Drive Callback] ✓ User info retrieved");
    console.log(`  - Email: ${userInfo.data.email}`);
    console.log(`  - Name: ${userInfo.data.name}`);

    // Calculate token expiry (expiry_date is already a timestamp in milliseconds)
    const tokenExpiry = new Date(tokens.expiry_date);

    // Check if integration already exists
    console.log("[Google Drive Callback] Checking for existing integration...");
    const existingIntegration = await findIntegration({
      userId,
      provider: CLOUD_PROVIDERS.GOOGLE_DRIVE,
    });
    console.log(`[Google Drive Callback] Existing integration: ${existingIntegration ? 'FOUND' : 'NOT FOUND'}`);

    if (existingIntegration) {
      // Update existing integration
      console.log("[Google Drive Callback] Updating existing integration...");
      console.log(`  - Was active: ${existingIntegration.isActive}`);
      const updateResult = await updateIntegrationTokens(existingIntegration._id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || existingIntegration.refreshToken,
        tokenExpiry,
      });
      console.log("[Google Drive Callback] ✓ Integration updated");
      console.log(`  - Updated integration ID: ${existingIntegration._id}`);
      console.log(`  - Now active: ${updateResult.isActive}`);
    } else {
      // Create new integration
      console.log("[Google Drive Callback] Creating new integration...");
      const newIntegration = await createIntegration({
        userId,
        provider: CLOUD_PROVIDERS.GOOGLE_DRIVE,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry,
        accountEmail: userInfo.data.email,
        accountName: userInfo.data.name,
        accountId: userInfo.data.id,
        scopes: tokens.scope ? tokens.scope.split(" ") : [],
        metadata: {
          picture: userInfo.data.picture,
        },
      });
      console.log("[Google Drive Callback] ✓ Integration created");
      console.log(`  - New integration ID: ${newIntegration._id}`);
    }

    // Redirect to frontend or local HTML page
    const redirectUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/settings/cloud?cloud_integration=success&provider=google_drive`
      : `/oauth-success.html?provider=google_drive`;

    console.log(`[Google Drive Callback] Redirecting to: ${redirectUrl}`);
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("❌ Error in Google Drive callback:", error);
    console.error("Error stack:", error.stack);

    const errorRedirectUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/settings/cloud?cloud_integration=error&provider=google_drive`
      : `/oauth-error.html?provider=google_drive`;

    return res.redirect(errorRedirectUrl);
  }
};

/**
 * Initiate Dropbox OAuth flow
 */
exports.initiateDropboxAuth = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { clientId } = getDropboxAuth();

    // Create DropboxAuth object (not Dropbox)
    const dbxAuth = new DropboxAuth({ clientId });

    // Generate auth URL with PKCE
    const authUrl = await dbxAuth.getAuthenticationUrl(
      process.env.DROPBOX_REDIRECT_URI,
      userId, // state parameter (userId)
      "code",
      "offline", // Get refresh token
      undefined,
      undefined,
      true // Use PKCE
    );

    // IMPORTANT: Access codeVerifier as a PROPERTY (not a method!)
    // This is set automatically by getAuthenticationUrl when PKCE is enabled
    const codeVerifier = dbxAuth.codeVerifier;

    if (!codeVerifier) {
      throw new Error("Code verifier was not generated by DropboxAuth");
    }

    const redis = getRedis();
    const redisKey = `dropbox:code_verifier:${userId}`;

    console.log(`[Dropbox Auth] Storing code verifier in Redis:`);
    console.log(`  - UserId: ${userId}`);
    console.log(`  - Redis Key: ${redisKey}`);
    console.log(`  - Code Verifier: ${codeVerifier.substring(0, 20)}...`);

    // Store code verifier in Redis with 10-minute expiry
    await redis.set(redisKey, codeVerifier, "EX", 600); // 600 seconds = 10 minutes

    // Verify it was stored
    const storedVerifier = await redis.get(redisKey);
    console.log(`  - Verification: ${storedVerifier ? 'Stored successfully ✓' : 'Storage failed ✗'}`);

    // Return OAuth URL to frontend instead of redirecting
    return generateResponse(
      {
        authUrl,
        provider: "dropbox"
      },
      "Dropbox authorization URL generated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error initiating Dropbox auth:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Dropbox OAuth callback handler
 */
exports.dropboxCallback = async (req, res, next) => {
  try {
    const { code, state: userId } = req.query;

    if (!code || !userId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Missing authorization code or user ID",
      });
    }

    // Retrieve code verifier from Redis
    const redis = getRedis();
    const redisKey = `dropbox:code_verifier:${userId}`;

    console.log(`[Dropbox Callback] Retrieving code verifier from Redis:`);
    console.log(`  - UserId: ${userId}`);
    console.log(`  - Redis Key: ${redisKey}`);

    // Check all keys in Redis for debugging
    const allKeys = await redis.keys('dropbox:code_verifier:*');
    console.log(`  - All Dropbox keys in Redis: ${allKeys.join(', ') || 'NONE'}`);

    const codeVerifier = await redis.get(redisKey);
    console.log(`  - Code Verifier: ${codeVerifier ? `${codeVerifier.substring(0, 20)}...` : 'NOT FOUND ✗'}`);

    if (!codeVerifier) {
      console.error("❌ Code verifier not found in Redis for userId:", userId);
      const errorRedirectUrl = process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/settings/cloud?cloud_integration=error&provider=dropbox`
        : `/oauth-error.html?provider=dropbox`;
      return res.redirect(errorRedirectUrl);
    }

    console.log(`  - Found verifier, deleting from Redis ✓`);
    // Delete the verifier after retrieving it (one-time use)
    await redis.del(redisKey);

    const { clientId } = getDropboxAuth();

    // Create DropboxAuth with ONLY clientId (PKCE replaces client secret)
    const dbxAuth = new DropboxAuth({
      clientId,
    });

    // IMPORTANT: Set code verifier BEFORE calling getAccessTokenFromCode
    dbxAuth.setCodeVerifier(codeVerifier);
    console.log(`  - Code verifier set on DropboxAuth object ✓`);

    // Exchange code for tokens using DropboxAuth
    const tokenResponse = await dbxAuth.getAccessTokenFromCode(
      process.env.DROPBOX_REDIRECT_URI,
      code
    );
    console.log(`  - Token exchange successful ✓`);

    const { access_token, refresh_token, expires_in } = tokenResponse.result;

    // Calculate token expiry (expires_in is in seconds)
    const tokenExpiry = new Date(Date.now() + expires_in * 1000);

    // Get user info from Dropbox using the new access token
    const dbx = new Dropbox({ accessToken: access_token });
    const accountInfo = await dbx.usersGetCurrentAccount();

    // Check if integration already exists
    const existingIntegration = await findIntegration({
      userId,
      provider: CLOUD_PROVIDERS.DROPBOX,
    });

    if (existingIntegration) {
      // Update existing integration
      await updateIntegrationTokens(existingIntegration._id, {
        accessToken: access_token,
        refreshToken: refresh_token || existingIntegration.refreshToken,
        tokenExpiry,
      });
    } else {
      // Create new integration
      await createIntegration({
        userId,
        provider: CLOUD_PROVIDERS.DROPBOX,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry,
        accountEmail: accountInfo.result.email,
        accountName: accountInfo.result.name.display_name,
        accountId: accountInfo.result.account_id,
        metadata: {
          country: accountInfo.result.country,
        },
      });
    }

    // Redirect to frontend or local HTML page
    const redirectUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/settings/cloud?cloud_integration=success&provider=dropbox`
      : `/oauth-success.html?provider=dropbox`;

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("Error in Dropbox callback:", error);

    const errorRedirectUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/settings/cloud?cloud_integration=error&provider=dropbox`
      : `/oauth-error.html?provider=dropbox`;

    return res.redirect(errorRedirectUrl);
  }
};

/**
 * Initiate OneDrive OAuth flow
 */
exports.initiateOneDriveAuth = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { clientId, redirectUri, scopes, authority } = getMicrosoftOAuthConfig();

    // Build authorization URL
    const authUrl = `${authority}/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&state=${userId}` +
      `&prompt=consent`; // Force consent to get refresh token

    // Return OAuth URL to frontend
    return generateResponse(
      {
        authUrl,
        provider: "onedrive"
      },
      "OneDrive authorization URL generated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error initiating OneDrive auth:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * OneDrive OAuth callback handler
 */
exports.oneDriveCallback = async (req, res, next) => {
  try {
    const { code, state: userId } = req.query;

    console.log(`[OneDrive Callback] Starting for userId: ${userId}`);

    if (!code || !userId) {
      console.error("[OneDrive Callback] Missing code or userId");
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Missing authorization code or user ID",
      });
    }

    const { clientId, clientSecret, redirectUri, authority } = getMicrosoftOAuthConfig();

    // Exchange code for tokens
    console.log("[OneDrive Callback] Exchanging code for tokens...");
    const tokenUrl = `${authority}/oauth2/v2.0/token`;

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error("[OneDrive Callback] Token exchange failed:", errorData);
      throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error}`);
    }

    const tokens = await tokenResponse.json();
    console.log("[OneDrive Callback] ✓ Token exchange successful");
    console.log(`  - Has access_token: ${!!tokens.access_token}`);
    console.log(`  - Has refresh_token: ${!!tokens.refresh_token}`);
    console.log(`  - Expires in: ${tokens.expires_in} seconds`);

    // Calculate token expiry (expires_in is in seconds)
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);

    // Get user info from Microsoft Graph
    console.log("[OneDrive Callback] Fetching user info...");
    const userInfoResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      throw new Error("Failed to fetch user info from Microsoft Graph");
    }

    const userInfo = await userInfoResponse.json();
    console.log("[OneDrive Callback] ✓ User info retrieved");
    console.log(`  - Email: ${userInfo.mail || userInfo.userPrincipalName}`);
    console.log(`  - Name: ${userInfo.displayName}`);

    // Check if integration already exists
    console.log("[OneDrive Callback] Checking for existing integration...");
    const existingIntegration = await findIntegration({
      userId,
      provider: CLOUD_PROVIDERS.ONEDRIVE,
    });
    console.log(`[OneDrive Callback] Existing integration: ${existingIntegration ? 'FOUND' : 'NOT FOUND'}`);

    if (existingIntegration) {
      // Update existing integration
      console.log("[OneDrive Callback] Updating existing integration...");
      console.log(`  - Was active: ${existingIntegration.isActive}`);
      const updateResult = await updateIntegrationTokens(existingIntegration._id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || existingIntegration.refreshToken,
        tokenExpiry,
      });
      console.log("[OneDrive Callback] ✓ Integration updated");
      console.log(`  - Updated integration ID: ${existingIntegration._id}`);
      console.log(`  - Now active: ${updateResult.isActive}`);
    } else {
      // Create new integration
      console.log("[OneDrive Callback] Creating new integration...");
      const newIntegration = await createIntegration({
        userId,
        provider: CLOUD_PROVIDERS.ONEDRIVE,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry,
        accountEmail: userInfo.mail || userInfo.userPrincipalName,
        accountName: userInfo.displayName,
        accountId: userInfo.id,
        scopes: tokens.scope ? tokens.scope.split(" ") : [],
        metadata: {
          userPrincipalName: userInfo.userPrincipalName,
        },
      });
      console.log("[OneDrive Callback] ✓ Integration created");
      console.log(`  - New integration ID: ${newIntegration._id}`);
    }

    // Redirect to frontend or local HTML page
    const redirectUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/settings/cloud?cloud_integration=success&provider=onedrive`
      : `/oauth-success.html?provider=onedrive`;

    console.log(`[OneDrive Callback] Redirecting to: ${redirectUrl}`);
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("❌ Error in OneDrive callback:", error);
    console.error("Error stack:", error.stack);

    const errorRedirectUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/settings/cloud?cloud_integration=error&provider=onedrive`
      : `/oauth-error.html?provider=onedrive`;

    return res.redirect(errorRedirectUrl);
  }
};

/**
 * Get all connected cloud services for the user
 */
exports.getConnectedServices = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const integrations = await findUserIntegrations(userId);

    // Return only safe information (no tokens)
    const services = integrations.map((integration) => ({
      id: integration._id,
      provider: integration.provider,
      accountEmail: integration.accountEmail,
      accountName: integration.accountName,
      isActive: integration.isActive,
      lastUsedAt: integration.lastUsedAt,
      createdAt: integration.createdAt,
    }));

    return generateResponse(
      { services },
      "Connected services retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error getting connected services:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Disconnect a cloud service integration
 */
exports.disconnectService = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { integrationId } = req.params;

    // Verify ownership
    const integration = await findIntegration({
      _id: integrationId,
      userId,
    });

    if (!integration) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Integration not found",
      });
    }

    // Disconnect integration
    await disconnectIntegration(integrationId);

    return generateResponse(
      null,
      "Service disconnected successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error disconnecting service:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Refresh Google Drive access token
 */
async function refreshGoogleDriveToken(integration) {
  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({
      refresh_token: integration.getDecryptedRefreshToken(),
    });

    const { credentials } = await oauth2Client.refreshAccessToken();
    const tokenExpiry = new Date(credentials.expiry_date);

    await updateIntegrationTokens(integration._id, {
      accessToken: credentials.access_token,
      tokenExpiry,
    });

    return credentials.access_token;
  } catch (error) {
    console.error("Error refreshing Google Drive token:", error);
    throw error;
  }
}

/**
 * Refresh Dropbox access token
 */
async function refreshDropboxToken(integration) {
  try {
    const { clientId, clientSecret } = getDropboxAuth();
    const dbx = new Dropbox({ clientId, clientSecret });

    dbx.auth.setRefreshToken(integration.getDecryptedRefreshToken());
    const tokenResponse = await dbx.auth.refreshAccessToken();

    const { access_token, expires_in } = tokenResponse.result;
    const tokenExpiry = new Date(Date.now() + expires_in * 1000);

    await updateIntegrationTokens(integration._id, {
      accessToken: access_token,
      tokenExpiry,
    });

    return access_token;
  } catch (error) {
    console.error("Error refreshing Dropbox token:", error);
    throw error;
  }
}

/**
 * Refresh OneDrive access token
 */
async function refreshOneDriveToken(integration) {
  try {
    const { clientId, clientSecret, authority } = getMicrosoftOAuthConfig();
    const tokenUrl = `${authority}/oauth2/v2.0/token`;

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: integration.getDecryptedRefreshToken(),
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error}`);
    }

    const tokens = await tokenResponse.json();
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);

    await updateIntegrationTokens(integration._id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || integration.refreshToken,
      tokenExpiry,
    });

    return tokens.access_token;
  } catch (error) {
    console.error("Error refreshing OneDrive token:", error);
    throw error;
  }
}

/**
 * Get valid access token (refresh if needed)
 */
async function getValidAccessToken(integration) {
  // Check if token is expired
  if (integration.isTokenExpired()) {
    console.log(`Token expired for ${integration.provider}, refreshing...`);

    if (integration.provider === CLOUD_PROVIDERS.GOOGLE_DRIVE) {
      return await refreshGoogleDriveToken(integration);
    } else if (integration.provider === CLOUD_PROVIDERS.DROPBOX) {
      return await refreshDropboxToken(integration);
    } else if (integration.provider === CLOUD_PROVIDERS.ONEDRIVE) {
      return await refreshOneDriveToken(integration);
    }
  }

  return integration.getDecryptedAccessToken();
}

/**
 * Browse Google Drive files
 */
exports.browseGoogleDriveFiles = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { folderId = "root", pageToken, pageSize = 20 } = req.query;

    // Find integration
    const integration = await findIntegrationWithTokens({
      userId,
      provider: CLOUD_PROVIDERS.GOOGLE_DRIVE,
      isActive: true,
    });

    if (!integration) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Google Drive not connected",
      });
    }

    // Get valid access token (will refresh if expired)
    const accessToken = await getValidAccessToken(integration);

    // Set up Google Drive client
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // List files in the specified folder
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: parseInt(pageSize),
      pageToken,
      fields:
        "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, thumbnailLink, iconLink)",
      orderBy: "folder,name",
    });

    // Update last used timestamp
    await integration.updateLastUsed();

    return generateResponse(
      {
        files: response.data.files,
        nextPageToken: response.data.nextPageToken,
      },
      "Google Drive files retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error browsing Google Drive files:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to browse Google Drive files",
    });
  }
};

/**
 * Browse Dropbox files
 */
exports.browseDropboxFiles = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { path = "", cursor } = req.query;

    // Find integration
    const integration = await findIntegrationWithTokens({
      userId,
      provider: CLOUD_PROVIDERS.DROPBOX,
      isActive: true,
    });

    if (!integration) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Dropbox not connected",
      });
    }

    // Get valid access token (will refresh if expired)
    const accessToken = await getValidAccessToken(integration);

    // Set up Dropbox client
    const dbx = new Dropbox({ accessToken });

    let response;
    if (cursor) {
      // Continue from cursor
      response = await dbx.filesListFolderContinue({ cursor });
    } else {
      // List files in the specified path
      response = await dbx.filesListFolder({
        path: path === "" ? "" : path,
        limit: 20,
      });
    }

    // Format files for consistent response
    const files = response.result.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      mimeType: entry[".tag"] === "folder" ? "folder" : "file",
      size: entry.size,
      modifiedTime: entry.server_modified || entry.client_modified,
      path: entry.path_display,
      isFolder: entry[".tag"] === "folder",
    }));

    // Update last used timestamp
    await integration.updateLastUsed();

    return generateResponse(
      {
        files,
        cursor: response.result.cursor,
        hasMore: response.result.has_more,
      },
      "Dropbox files retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error browsing Dropbox files:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to browse Dropbox files",
    });
  }
};

/**
 * Browse OneDrive files
 */
exports.browseOneDriveFiles = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { folderId = "root", pageToken } = req.query;

    // Find integration
    const integration = await findIntegrationWithTokens({
      userId,
      provider: CLOUD_PROVIDERS.ONEDRIVE,
      isActive: true,
    });

    if (!integration) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "OneDrive not connected",
      });
    }

    // Get valid access token (will refresh if expired)
    const accessToken = await getValidAccessToken(integration);

    // Build API URL
    const baseUrl = "https://graph.microsoft.com/v1.0";
    const endpoint = folderId === "root"
      ? `${baseUrl}/me/drive/root/children`
      : `${baseUrl}/me/drive/items/${folderId}/children`;

    // Add pagination if pageToken provided
    const url = pageToken ? pageToken : `${endpoint}?$top=20`;

    // Fetch files from Microsoft Graph
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Microsoft Graph API error: ${errorData.error?.message || "Unknown error"}`);
    }

    const data = await response.json();

    // Format files for consistent response
    const files = data.value.map((item) => ({
      id: item.id,
      name: item.name,
      mimeType: item.folder ? "application/vnd.microsoft.folder" : item.file?.mimeType || "application/octet-stream",
      size: item.size,
      modifiedTime: item.lastModifiedDateTime,
      webViewLink: item.webUrl,
      thumbnailLink: item.thumbnails?.[0]?.large?.url,
      isFolder: !!item.folder,
      parentReference: item.parentReference,
    }));

    // Update last used timestamp
    await integration.updateLastUsed();

    return generateResponse(
      {
        files,
        nextPageToken: data["@odata.nextLink"], // Microsoft Graph pagination
      },
      "OneDrive files retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error browsing OneDrive files:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to browse OneDrive files",
    });
  }
};

/**
 * Get file metadata from cloud storage
 */
exports.getFileMetadata = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { provider, fileId } = req.query;

    if (!provider || !fileId) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Provider and fileId are required",
      });
    }

    // Find integration
    const integration = await findIntegrationWithTokens({
      userId,
      provider,
      isActive: true,
    });

    if (!integration) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: `${provider} not connected`,
      });
    }

    // Get valid access token
    const accessToken = await getValidAccessToken(integration);

    let fileMetadata;

    if (provider === CLOUD_PROVIDERS.GOOGLE_DRIVE) {
      const oauth2Client = getGoogleOAuthClient();
      oauth2Client.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: "v3", auth: oauth2Client });

      const response = await drive.files.get({
        fileId,
        fields:
          "id, name, mimeType, size, modifiedTime, webViewLink, thumbnailLink, iconLink",
      });

      fileMetadata = response.data;
    } else if (provider === CLOUD_PROVIDERS.DROPBOX) {
      const dbx = new Dropbox({ accessToken });
      const response = await dbx.filesGetMetadata({ path: fileId });

      fileMetadata = {
        id: response.result.id,
        name: response.result.name,
        size: response.result.size,
        modifiedTime: response.result.server_modified,
        path: response.result.path_display,
      };
    } else if (provider === CLOUD_PROVIDERS.ONEDRIVE) {
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Microsoft Graph API error: ${errorData.error?.message || "Unknown error"}`);
      }

      const item = await response.json();

      fileMetadata = {
        id: item.id,
        name: item.name,
        mimeType: item.folder ? "application/vnd.microsoft.folder" : item.file?.mimeType || "application/octet-stream",
        size: item.size,
        modifiedTime: item.lastModifiedDateTime,
        webViewLink: item.webUrl,
        thumbnailLink: item.thumbnails?.[0]?.large?.url,
        isFolder: !!item.folder,
      };
    }

    return generateResponse(
      { file: fileMetadata },
      "File metadata retrieved successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error getting file metadata:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message || "Failed to get file metadata",
    });
  }
};
