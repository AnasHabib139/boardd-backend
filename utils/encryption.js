"use strict";

const crypto = require("crypto");

// Algorithm for encryption
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // For AES, this is always 16
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Get encryption key from environment variable
 * The key should be a 32-byte (256-bit) base64-encoded string stored in ENCRYPTION_KEY env var
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  // Decode the base64-encoded key
  const keyBuffer = Buffer.from(key, 'base64');

  // Ensure the key is exactly 32 bytes for AES-256
  if (keyBuffer.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must be exactly 32 bytes (256 bits). Current length: ${keyBuffer.length} bytes. Please regenerate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  }

  return keyBuffer;
}

/**
 * Encrypt sensitive data (like OAuth tokens)
 * @param {string} plainText - The text to encrypt
 * @returns {string} - Base64 encoded encrypted string with salt, iv, tag, and encrypted data
 */
function encrypt(plainText) {
  if (!plainText) {
    return null;
  }

  try {
    const key = getEncryptionKey();

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key using PBKDF2
    const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, "sha512");

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);

    // Encrypt the data
    const encrypted = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);

    // Get authentication tag
    const tag = cipher.getAuthTag();

    // Combine salt + iv + tag + encrypted data
    const result = Buffer.concat([salt, iv, tag, encrypted]);

    // Return as base64 string
    return result.toString("base64");
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
}

/**
 * Decrypt sensitive data (like OAuth tokens)
 * @param {string} encryptedText - Base64 encoded encrypted string
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedText) {
  if (!encryptedText) {
    return null;
  }

  try {
    const key = getEncryptionKey();

    // Convert from base64
    const data = Buffer.from(encryptedText, "base64");

    // Extract salt, iv, tag, and encrypted data
    const salt = data.slice(0, SALT_LENGTH);
    const iv = data.slice(SALT_LENGTH, TAG_POSITION);
    const tag = data.slice(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = data.slice(ENCRYPTED_POSITION);

    // Derive the same key using PBKDF2
    const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, "sha512");

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);

    // Decrypt the data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt data");
  }
}

/**
 * Generate a random encryption key
 * Use this to generate the ENCRYPTION_KEY for your .env file
 * @returns {string} - 32-byte random string in base64
 */
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString("base64");
}

module.exports = {
  encrypt,
  decrypt,
  generateEncryptionKey,
};
