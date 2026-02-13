const bcrypt = require("bcrypt");
const { generateResponse } = require("../../../utils");
const { STATUS_CODES } = require("../../../utils/constants");
const crypto = require("crypto");

// Password related helpers
exports.hashPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

exports.comparePassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};

// Token generation helpers
exports.generateJoinToken = () => {
  return crypto.randomBytes(24).toString("hex");
};

// Invite slots helper
exports.createInviteSlots = async (companyId, createManyInviteSlots) => {
  const companySlotCount = parseInt(process.env.INVITE_SLOT_COUNT) || 5;
  const guestSlotCount = parseInt(process.env.GUEST_INVITE_SLOT_COUNT) || 5;

  // Create company invite slots (existing functionality)
  const companySlots = Array.from({ length: companySlotCount }, (_, i) => ({
    companyId,
    slot: i + 1,
    token: exports.generateJoinToken(),
    isGuestInviteSlot: false,
    inviteType: "company",
  }));

  // Create guest invite slots (new functionality)
  const guestSlots = Array.from({ length: guestSlotCount }, (_, i) => ({
    companyId,
    slot: companySlotCount + i + 1, // Continue slot numbering
    token: exports.generateJoinToken(),
    isGuestInviteSlot: true,
    inviteType: "guest",
  }));

  // Combine and create all slots
  const allSlots = [...companySlots, ...guestSlots];
  return createManyInviteSlots(allSlots);
};
