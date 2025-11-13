const mongoose = require("mongoose");

module.exports = {
  name: "031_create_search_text_indexes",
  version: 31,
  description: "Create text indexes on Task and User collections for global search functionality",

  async up() {
    const db = mongoose.connection.db;

    try {
      // Create text index on tasks collection
      await db.collection("tasks").createIndex(
        {
          title: "text",
          description: "text",
          tags: "text"
        },
        {
          name: "task_search_text_index",
          weights: {
            title: 10,      // Title matches are most important
            description: 5, // Description matches are moderately important
            tags: 3         // Tag matches are less important
          }
        }
      );

      console.log("✓ Created text index on tasks collection");

      // Create text index on users collection
      await db.collection("users").createIndex(
        {
          name: "text",
          email: "text",
          nickname: "text",
          title: "text",
          designation: "text"
        },
        {
          name: "user_search_text_index",
          weights: {
            name: 10,        // Name matches are most important
            email: 8,        // Email matches are very important
            nickname: 5,     // Nickname matches are moderately important
            title: 3,        // Title matches are less important
            designation: 3   // Designation matches are less important
          }
        }
      );

      console.log("✓ Created text index on users collection");

      return {
        success: true,
        message: "Successfully created text indexes for global search"
      };
    } catch (error) {
      console.error("✗ Error creating text indexes:", error.message);
      throw error;
    }
  },

  async down() {
    const db = mongoose.connection.db;

    try {
      // Drop text index from tasks collection
      await db.collection("tasks").dropIndex("task_search_text_index");
      console.log("✓ Dropped text index from tasks collection");

      // Drop text index from users collection
      await db.collection("users").dropIndex("user_search_text_index");
      console.log("✓ Dropped text index from users collection");

      return {
        success: true,
        message: "Successfully removed text indexes"
      };
    } catch (error) {
      console.error("✗ Error dropping text indexes:", error.message);
      throw error;
    }
  }
};
