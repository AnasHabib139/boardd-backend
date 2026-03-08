"use strict";

const { OAuth2Client } = require("google-auth-library");
const { CONSUMER_DOMAINS } = require("../utils/constants");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID_FOR_LOGIN);

/**
 * Verify a Google ID token and return the payload.
 * @param {string} idToken - The Google ID token from the frontend
 * @returns {{ googleId: string, email: string, name: string, picture: string, hd: string|undefined }}
 */
exports.verifyGoogleIdToken = async (idToken) => {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID_FOR_LOGIN,
  });

  const payload = ticket.getPayload();

  if (!payload.email_verified) {
    throw new Error("Google email is not verified");
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || null,
    hd: payload.hd || null,
  };
};

/**
 * Detect whether a Google account is a consumer (personal) account.
 * @param {{ hd: string|null, email: string }} payload
 * @returns {{ isConsumer: boolean }}
 */
exports.checkConsumerAccount = (payload) => {
  if (!payload.hd) {
    return { isConsumer: true };
  }

  const domain = payload.email.split("@")[1].toLowerCase();
  if (CONSUMER_DOMAINS.includes(domain)) {
    return { isConsumer: true };
  }

  return { isConsumer: false };
};
