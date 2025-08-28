"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const {
  calculateDurationMinutes,
} = require("../controller/helpers/timeHelper");
const { getMongooseAggregatePaginatedData } = require("../utils");

const timeEntrySchema = new Schema({
  userId: {
    type: Types.ObjectId,
    ref: "User",
    required: true,
  },
  title: {
    type: String,
    trim: true,
    maxlength: 200,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
  },
  totalTime: {
    type: Number, // Duration in minutes (with decimal precision)
    default: 0,
  },
  daysAdded: {
    type: Number, // Number of days added to end time (0 = same day, 1 = next day, -1 = previous day)
    default: 0,
  },
  parentEntryId: {
    type: Types.ObjectId,
    ref: "TimeEntry",
    default: null, // null = parent entry, ObjectId = child entry
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes
timeEntrySchema.index({ userId: 1, createdAt: -1 });
timeEntrySchema.index({ userId: 1, isActive: 1 });
timeEntrySchema.index({ startTime: 1 });
timeEntrySchema.index({ parentEntryId: 1 });
timeEntrySchema.index({ userId: 1, parentEntryId: 1 });

// Add pagination plugins
timeEntrySchema.plugin(mongoosePaginate);
timeEntrySchema.plugin(aggregatePaginate);

// Pre-save middleware to calculate totalTime and update updatedAt
timeEntrySchema.pre("save", function (next) {
  this.updatedAt = Date.now();

  // Calculate totalTime if both startTime and endTime are present
  if (this.startTime && this.endTime) {
    this.totalTime = calculateDurationMinutes(this.startTime, this.endTime);
  }

  next();
});

const TimeEntry = model("TimeEntry", timeEntrySchema);

// Model utility functions
exports.createTimeEntry = async (timeEntryData) => {
  const timeEntry = new TimeEntry(timeEntryData);
  return await timeEntry.save();
};

exports.findTimeEntry = async (query) => {
  return await TimeEntry.findOne(query);
};

exports.updateTimeEntry = async (query, updateData, options = {}) => {
  // If endTime is being set, calculate totalTime manually
  if (updateData.endTime) {
    const timeEntry = await TimeEntry.findOne(query);
    if (timeEntry && timeEntry.startTime) {
      updateData.totalTime = calculateDurationMinutes(
        timeEntry.startTime,
        updateData.endTime
      );
    }
  }

  // If both startTime and endTime are being updated
  if (updateData.startTime && updateData.endTime) {
    updateData.totalTime = calculateDurationMinutes(
      updateData.startTime,
      updateData.endTime
    );
  }

  updateData.updatedAt = Date.now();

  return await TimeEntry.findOneAndUpdate(query, updateData, {
    new: true,
    runValidators: true,
    ...options,
  });
};

exports.findActiveTimeEntry = async (userId) => {
  return await TimeEntry.findOne({
    userId,
    isActive: true,
    endTime: { $exists: false }, // No end time means it's still running
  });
};

exports.getAllTimeEntries = async ({
  query,
  page,
  limit,
  responseKey = "timeEntries",
  sort,
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TimeEntry,
    query,
    page,
    limit,
    sort,
  });
  return { [responseKey]: data, pagination };
};

// Find children of a parent entry
exports.findChildEntries = async (parentEntryId) => {
  return await TimeEntry.find({ parentEntryId });
};

// Check if parent has children
exports.hasChildren = async (parentEntryId) => {
  const children = await TimeEntry.find({ parentEntryId });
  return children.length > 0;
};

// Update parent entry with aggregated data from children
exports.updateParentEntryAggregates = async (parentEntryId) => {
  const children = await TimeEntry.find({ parentEntryId });
  const parent = await TimeEntry.findById(parentEntryId);

  if (!parent) return null;

  // Calculate total time from parent + all children
  let totalTime = parent.totalTime || 0;
  let latestEndTime = parent.endTime;
  let latestDaysAdded = parent.daysAdded || 0;
  let latestEntry = parent;

  children.forEach((child) => {
    if (child.totalTime) {
      totalTime += child.totalTime;
    }
    if (child.endTime && (!latestEndTime || child.endTime > latestEndTime)) {
      latestEndTime = child.endTime;
      latestDaysAdded = child.daysAdded || 0;
      latestEntry = child;
    }
  });

  // Update parent with aggregated data
  return await TimeEntry.findByIdAndUpdate(
    parentEntryId,
    {
      totalTime,
      endTime: latestEndTime,
      daysAdded: latestDaysAdded,
      updatedAt: Date.now(),
    },
    { new: true, runValidators: true }
  );
};

// Delete time entry by ID
exports.deleteTimeEntry = async (entryId) => {
  return await TimeEntry.findByIdAndDelete(entryId);
};

// Recursively delete all children of a parent entry
exports.deleteChildrenRecursively = async (parentEntryId) => {
  const children = await TimeEntry.find({ parentEntryId });

  for (const child of children) {
    // If child has its own children (nested), delete them first
    await exports.deleteChildrenRecursively(child._id);
    // Then delete the child itself
    await TimeEntry.findByIdAndDelete(child._id);
  }

  return children.length; // Return count of deleted children
};

// Delete time entry with all its children (if parent)
exports.deleteTimeEntryWithChildren = async (entryId) => {
  const entry = await TimeEntry.findById(entryId);
  if (!entry) return null;

  let deletedCount = 0;

  // If this is a parent entry (no parentEntryId), delete all children first
  if (!entry.parentEntryId) {
    deletedCount = await exports.deleteChildrenRecursively(entryId);
  }

  // Delete the main entry itself
  const deletedEntry = await TimeEntry.findByIdAndDelete(entryId);
  deletedCount += 1;

  return {
    deletedEntry,
    totalDeleted: deletedCount,
  };
};

exports.TimeEntry = TimeEntry;
