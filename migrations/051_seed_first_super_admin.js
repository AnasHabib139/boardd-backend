"use strict";

const { model } = require("mongoose");
const { hashSuperAdminPassword } = require("../controller/helpers/superAdmin/auth.helper");

module.exports = {
  name: "051_seed_first_super_admin",
  version: "1.0.0",
  description:
    "One-off bootstrap: seed the first SuperAdmin account from SUPER_ADMIN_BOOTSTRAP_* env vars (no self-serve creation path exists)",

  async up() {
    try {
      console.log("Starting first-SuperAdmin bootstrap...");

      const { SUPER_ADMIN_BOOTSTRAP_EMAIL, SUPER_ADMIN_BOOTSTRAP_PASSWORD, SUPER_ADMIN_BOOTSTRAP_NAME } = process.env;

      if (!SUPER_ADMIN_BOOTSTRAP_EMAIL || !SUPER_ADMIN_BOOTSTRAP_PASSWORD || !SUPER_ADMIN_BOOTSTRAP_NAME) {
        console.log(
          "SUPER_ADMIN_BOOTSTRAP_EMAIL / SUPER_ADMIN_BOOTSTRAP_PASSWORD / SUPER_ADMIN_BOOTSTRAP_NAME not all set, skipping bootstrap"
        );
        return { success: true, message: "Skipped: bootstrap env vars not configured" };
      }

      const SuperAdminModel = model("SuperAdmin");
      const email = SUPER_ADMIN_BOOTSTRAP_EMAIL.toLowerCase().trim();

      const existing = await SuperAdminModel.findOne({ email });
      if (existing) {
        console.log(`SuperAdmin already exists for ${email}, skipping`);
        return { success: true, message: `Skipped: SuperAdmin already exists for ${email}` };
      }

      const hashedPassword = await hashSuperAdminPassword(SUPER_ADMIN_BOOTSTRAP_PASSWORD);

      await SuperAdminModel.create({
        name: SUPER_ADMIN_BOOTSTRAP_NAME,
        email,
        password: hashedPassword,
      });

      console.log(`Created first SuperAdmin: ${email}`);

      return { success: true, message: `Created first SuperAdmin: ${email}` };
    } catch (error) {
      console.error("Migration failed:", error);
      return { success: false, message: `Migration failed: ${error.message}` };
    }
  },

  async down() {
    console.log("No-op: down() intentionally does not delete the seeded SuperAdmin account.");
    return { success: true, message: "No-op: seeded SuperAdmin is not removed by rollback" };
  },
};
