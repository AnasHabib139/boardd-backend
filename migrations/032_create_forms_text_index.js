const mongoose = require("mongoose");

module.exports = {
  name: "032_create_forms_text_index",
  version: 32,
  description: "Create text index on forms collection for global search (folders, documents, templates)",

  async up() {
    const db = mongoose.connection.db;

    try {
      // Create text index on forms collection
      await db.collection("forms").createIndex(
        {
          title: "text",
          description: "text"
        },
        {
          name: "form_search_text_index",
          weights: {
            title: 10,       // Title matches are most important
            description: 5   // Description matches are secondary
          }
        }
      );

      console.log("✓ Created text index on forms collection");

      return {
        success: true,
        message: "Successfully created text index on forms collection for global search"
      };
    } catch (error) {
      console.error("✗ Error creating forms text index:", error.message);
      throw error;
    }
  },

  async down() {
    const db = mongoose.connection.db;

    try {
      // Drop text index from forms collection
      await db.collection("forms").dropIndex("form_search_text_index");
      console.log("✓ Dropped text index from forms collection");

      return {
        success: true,
        message: "Successfully removed text index from forms collection"
      };
    } catch (error) {
      console.error("✗ Error dropping forms text index:", error.message);
      throw error;
    }
  }
};
