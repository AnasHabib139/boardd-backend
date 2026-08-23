"use strict";

const bcrypt = require("bcrypt");

// Password related helpers
exports.hashSuperAdminPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

exports.compareSuperAdminPassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};
