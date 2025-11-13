const mongoose = require("mongoose");

module.exports = {
  name: "030_update_user_notification_preferences",
  version: 30,
  description: "Update user notification preferences: remove desktop, add sms and payment notifications",

  async up() {
    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    // Update all users
    const result = await usersCollection.updateMany(
      {},
      {
        $unset: {
          "settings.notifications.desktop": ""  // Remove desktop field
        },
        $set: {
          "settings.notifications.sms": true,
          "settings.notifications.paymentReminders": true,
          "settings.notifications.paymentSuccess": true,
          "settings.notifications.paymentFailure": true
        }
      }
    );

    console.log(`✓ Updated ${result.modifiedCount} users with new notification preferences`);

    return {
      success: true,
      message: `Updated ${result.modifiedCount} users with new notification preferences`
    };
  },

  async down() {
    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    // Rollback: restore desktop, remove new fields
    const result = await usersCollection.updateMany(
      {},
      {
        $set: {
          "settings.notifications.desktop": false  // Restore desktop with default
        },
        $unset: {
          "settings.notifications.sms": "",
          "settings.notifications.paymentReminders": "",
          "settings.notifications.paymentSuccess": "",
          "settings.notifications.paymentFailure": ""
        }
      }
    );

    console.log(`✓ Rolled back ${result.modifiedCount} users to previous notification structure`);

    return {
      success: true,
      message: `Rolled back ${result.modifiedCount} users to previous notification structure`
    };
  }
};
