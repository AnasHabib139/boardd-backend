"use strict";

const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// Password related helpers
exports.hashSuperAdminPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

exports.compareSuperAdminPassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};

// Token related helpers
exports.generateSuperAdminToken = (superAdmin) => {
  const jti = uuidv4(); // Generate unique JWT ID

  const token = sign(
    {
      id: superAdmin._id,
      email: superAdmin.email,
      type: "super_admin",
      jti: jti,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_TTL
        ? `${process.env.ACCESS_TOKEN_TTL}s`
        : process.env.JWT_EXPIRATION,
    }
  );

  return { token, jti };
};
