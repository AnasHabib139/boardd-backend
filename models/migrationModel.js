const { Schema, model } = require("mongoose");

const migrationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    executedAt: {
      type: Date,
      default: Date.now,
    },
    version: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    success: {
      type: Boolean,
      default: true,
    },
    error: {
      type: String,
    },
  },
  { timestamps: true }
);

const MigrationModel = model("Migration", migrationSchema);

// Check if migration has been executed
exports.isMigrationExecuted = async (name) => {
  const migration = await MigrationModel.findOne({ name, success: true });
  return !!migration;
};

// Record successful migration
exports.recordMigration = async (name, version, description) => {
  return MigrationModel.create({
    name,
    version,
    description,
    success: true,
    executedAt: new Date(),
  });
};

// Record failed migration
exports.recordFailedMigration = async (name, version, description, error) => {
  // Use upsert to avoid duplicate key errors
  return MigrationModel.findOneAndUpdate(
    { name },
    {
      name,
      version,
      description,
      success: false,
      error: error.message || error,
      executedAt: new Date(),
    },
    { upsert: true, new: true }
  );
};

// Get all executed migrations
exports.getExecutedMigrations = async () => {
  return MigrationModel.find({ success: true }).sort({ executedAt: 1 });
};
