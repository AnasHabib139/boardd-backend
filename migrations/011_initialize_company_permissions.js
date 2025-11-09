const { model } = require("mongoose");

module.exports = {
  name: "011_initialize_company_permissions",
  version: "1.0.0",
  description:
    "Create CompanyPermissionPolicy documents for all existing companies with default permission settings",

  async up() {
    try {
      console.log("🔄 Initializing company permission policies...");

      const CompanyModel = model("Company");
      const CompanyPermissionPolicyModel = model("CompanyPermissionPolicy");

      // Get all companies
      const companies = await CompanyModel.find({ isDeleted: false });

      if (companies.length === 0) {
        console.log("ℹ️ No companies found to initialize");
        return { success: true, message: "No companies to initialize" };
      }

      console.log(`📊 Found ${companies.length} companies to initialize`);

      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const company of companies) {
        try {
          // Check if permission policy already exists
          const existingPolicy = await CompanyPermissionPolicyModel.findOne({
            companyId: company._id,
          });

          if (existingPolicy) {
            console.log(
              `⏭️ Company "${company.name}" already has permission policy, skipping`
            );
            skippedCount++;
            continue;
          }

          // Create default permission policy
          await CompanyPermissionPolicyModel.create({
            companyId: company._id,
          });

          createdCount++;
          console.log(
            `✅ Created permission policy for company: ${company.name}`
          );
        } catch (error) {
          console.error(
            `❌ Error creating policy for company ${company.name}:`,
            error.message
          );
          errorCount++;
        }
      }

      console.log(`🎉 Initialization completed!`);
      console.log(`   ✅ Created: ${createdCount} policies`);
      console.log(`   ⏭️ Skipped: ${skippedCount} (already exist)`);
      console.log(`   ❌ Errors: ${errorCount}`);

      return {
        success: true,
        message: `Successfully created ${createdCount} permission policies, skipped ${skippedCount}, errors ${errorCount}`,
      };
    } catch (error) {
      console.error("❌ Migration failed:", error);
      return {
        success: false,
        message: `Migration failed: ${error.message}`,
      };
    }
  },

  async down() {
    try {
      console.log("⬇️ Rolling back permission policy initialization...");

      const CompanyPermissionPolicyModel = model("CompanyPermissionPolicy");

      // Delete all permission policies
      const result = await CompanyPermissionPolicyModel.deleteMany({});

      console.log(
        `✅ Rollback completed! Deleted ${result.deletedCount} permission policies`
      );

      return {
        success: true,
        message: `Successfully deleted ${result.deletedCount} permission policies`,
      };
    } catch (error) {
      console.error("❌ Rollback failed:", error);
      return {
        success: false,
        message: `Rollback failed: ${error.message}`,
      };
    }
  },
};
