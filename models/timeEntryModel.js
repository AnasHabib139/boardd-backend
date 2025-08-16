"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { calculateDurationMinutes } = require("../controller/helpers/timeHelper");
const { getMongooseAggregatePaginatedData } = require("../utils");

const timeEntrySchema = new Schema({
  userId: { 
    type: Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  title: { 
    type: String, 
    trim: true, 
    maxlength: 200 
  },
  description: { 
    type: String, 
    trim: true, 
    maxlength: 1000 
  },
  startTime: { 
    type: Date, 
    required: true 
  },
  endTime: { 
    type: Date 
  },
  totalTime: { 
    type: Number, // Duration in minutes (with decimal precision)
    default: 0 
  },
  daysAdded: {
    type: Number, // Number of days added to end time (0 = same day, 1 = next day, -1 = previous day)
    default: 0
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Indexes
timeEntrySchema.index({ userId: 1, createdAt: -1 });
timeEntrySchema.index({ userId: 1, isActive: 1 });
timeEntrySchema.index({ startTime: 1 });

// Add pagination plugins
timeEntrySchema.plugin(mongoosePaginate);
timeEntrySchema.plugin(aggregatePaginate);

// Pre-save middleware to calculate totalTime and update updatedAt
timeEntrySchema.pre('save', function(next) {
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
      updateData.totalTime = calculateDurationMinutes(timeEntry.startTime, updateData.endTime);
    }
  }
  
  // If both startTime and endTime are being updated
  if (updateData.startTime && updateData.endTime) {
    updateData.totalTime = calculateDurationMinutes(updateData.startTime, updateData.endTime);
  }
  
  updateData.updatedAt = Date.now();
  
  return await TimeEntry.findOneAndUpdate(query, updateData, { 
    new: true, 
    runValidators: true,
    ...options 
  });
};

exports.findActiveTimeEntry = async (userId) => {
  return await TimeEntry.findOne({
    userId,
    isActive: true,
    endTime: { $exists: false } // No end time means it's still running
  });
};

exports.getAllTimeEntries = async ({ query, page, limit, responseKey = "timeEntries" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TimeEntry,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};

exports.TimeEntry = TimeEntry;