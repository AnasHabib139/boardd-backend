"use strict";

const { updateUserIntegration } = require("../../../models/userIntegrationModel");

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000; // 60 days, used when the provider omits expires_in

// Returns a valid access token for the integration, refreshing it first if it's
// expired or about to expire. `refreshFn` is the provider's refreshAccessToken(refreshToken).
exports.getValidToken = async (integration, refreshFn) => {
  const isExpiring =
    !integration.tokenExpiry ||
    new Date(integration.tokenExpiry).getTime() - Date.now() < FIVE_MINUTES_MS;

  if (!isExpiring) return integration.accessToken;

  const refreshed = await refreshFn(integration.refreshToken);
  const expiresInMs = (refreshed.expires_in ?? DEFAULT_EXPIRY_MS / 1000) * 1000;
  const expiry = new Date(Date.now() + expiresInMs);

  await updateUserIntegration(
    { _id: integration._id },
    {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiry: expiry,
    }
  );

  return refreshed.access_token;
};
