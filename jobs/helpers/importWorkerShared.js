"use strict";

const { getIO } = require("../../utils/socket");
const { updateUserIntegration } = require("../../models/userIntegrationModel");

exports.slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

exports.ensureUniqueSlug = (slug, seen) => {
  if (!seen.has(slug)) {
    seen.add(slug);
    return slug;
  }
  let i = 2;
  while (seen.has(`${slug}_${i}`)) i++;
  const unique = `${slug}_${i}`;
  seen.add(unique);
  return unique;
};

exports.STATUS_COLORS = [
  "#6C63FF", "#F59E0B", "#10B981", "#EF4444",
  "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6",
];
exports.assignColor = (index) => exports.STATUS_COLORS[index % exports.STATUS_COLORS.length];

exports.emitProgress = (userId, jobId, payload) => {
  try {
    const io = getIO();
    if (io) io.to(`user:${userId}`).emit("import:progress", { jobId, ...payload });
  } catch (_) {}
};

// Refreshes tokenState.token in place if it's expiring, persisting via
// updateUserIntegration. Returns the (possibly unchanged) access token.
exports.refreshWorkerToken = async (tokenState, userIdStr, platform, refreshFn) => {
  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring =
    !tokenState.tokenExpiry ||
    new Date(tokenState.tokenExpiry).getTime() - Date.now() < fiveMinutes;

  if (!isExpiring) return tokenState.token;

  const refreshed = await refreshFn(tokenState.refreshToken);
  const expiry = new Date(Date.now() + refreshed.expires_in * 1000);

  await updateUserIntegration(
    { userId: userIdStr, platform },
    { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, tokenExpiry: expiry }
  );

  tokenState.token = refreshed.access_token;
  tokenState.refreshToken = refreshed.refresh_token;
  tokenState.tokenExpiry = expiry;

  return refreshed.access_token;
};

exports.STANDARD_QUEUE_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 },
};
