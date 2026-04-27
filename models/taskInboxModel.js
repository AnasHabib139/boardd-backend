"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const taskInboxSchema = new Schema({
  userId: {
    type: Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  taskId: {
    type: Types.ObjectId,
    ref: "Task",
    required: true,
    index: true
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  isCleared: {
    type: Boolean,
    default: false,
    index: true
  },
  clearedAt: {
    type: Date,
    default: null,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for performance
taskInboxSchema.index({ userId: 1, taskId: 1 }, { unique: true }); // Unique per user-task
taskInboxSchema.index({ userId: 1, isRead: 1 }); // Filter unread
taskInboxSchema.index({ userId: 1, isCleared: 1 }); // Filter active inbox
taskInboxSchema.index({ userId: 1, createdAt: -1 }); // Sort by newest

// Add pagination plugins
taskInboxSchema.plugin(mongoosePaginate);
taskInboxSchema.plugin(aggregatePaginate);

// Pre-save middleware to update updatedAt
taskInboxSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const TaskInbox = model("TaskInbox", taskInboxSchema);

// Model utility functions

/**
 * Create a new task inbox entry
 * @param {Object} inboxData - Inbox entry data
 * @returns {Promise<Object>} Created inbox entry
 */
exports.createTaskInboxEntry = async (inboxData) => {
  const inboxEntry = new TaskInbox(inboxData);
  return await inboxEntry.save();
};

/**
 * Find a specific task inbox entry
 * @param {Object} query - Query object
 * @returns {Promise<Object|null>} Inbox entry or null
 */
exports.findTaskInboxEntry = async (query) => {
  return await TaskInbox.findOne(query);
};

/**
 * Update task inbox entry
 * @param {Object} query - Query object
 * @param {Object} updateData - Update data
 * @param {Object} options - Update options
 * @returns {Promise<Object>} Updated inbox entry
 */
exports.updateTaskInboxEntry = async (query, updateData, options = {}) => {
  updateData.updatedAt = Date.now();
  
  return await TaskInbox.findOneAndUpdate(query, updateData, {
    new: true,
    runValidators: true,
    ...options
  });
};

/**
 * Upsert task inbox entry (create if not exists, update if exists)
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {Object} updateData - Data to update/set
 * @returns {Promise<Object>} Upserted inbox entry
 */
exports.upsertTaskInboxEntry = async (userId, taskId, updateData = {}) => {
  const query = {
    userId: Types.ObjectId.createFromHexString(userId),
    taskId: Types.ObjectId.createFromHexString(taskId)
  };

  const update = {
    ...updateData,
    updatedAt: Date.now()
  };

  return await TaskInbox.findOneAndUpdate(query, update, {
    new: true,
    upsert: true,
    runValidators: true
  });
};

/**
 * Mark task inbox entry as read
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @returns {Promise<Object>} Updated inbox entry
 */
exports.markAsRead = async (userId, taskId) => {
  return await exports.upsertTaskInboxEntry(userId, taskId, { isRead: true });
};

/**
 * Mark task inbox entry as cleared
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @returns {Promise<Object>} Updated inbox entry
 */
exports.markAsCleared = async (userId, taskId) => {
  return await exports.upsertTaskInboxEntry(userId, taskId, { isCleared: true });
};

/**
 * Get user's task inbox entries
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Paginated inbox entries
 */
exports.findUserTaskInboxEntries = async ({ query, page, limit, responseKey = "inboxEntries" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TaskInbox,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};

/**
 * Bulk create task inbox entries for multiple users
 * @param {Array} entries - Array of {userId, taskId} objects
 * @returns {Promise<Array>} Created entries
 */
exports.bulkCreateTaskInboxEntries = async (entries) => {
  const inboxEntries = entries.map(entry => ({
    userId: Types.ObjectId.createFromHexString(entry.userId),
    taskId: Types.ObjectId.createFromHexString(entry.taskId),
    isRead: false,
    isCleared: false
  }));

  return await TaskInbox.insertMany(inboxEntries, { ordered: false }); // Continue on duplicates
};

/**
 * Get tasks that need inbox entries for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Task IDs that need inbox entries
 */
exports.getTasksNeedingInboxEntries = async (userId) => {
  const pipeline = [
    // Get all tasks user is assigned to or created
    {
      $match: {
        isActive: true,
        $or: [
          { assignedTo: Types.ObjectId.createFromHexString(userId) },
          { createdBy: Types.ObjectId.createFromHexString(userId) }
        ]
      }
    },
    
    // Lookup existing inbox entries
    {
      $lookup: {
        from: "taskinboxes",
        let: { taskId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$taskId", "$$taskId"] },
                  { $eq: ["$userId", Types.ObjectId.createFromHexString(userId)] }
                ]
              }
            }
          }
        ],
        as: "inboxEntry"
      }
    },
    
    // Only return tasks that don't have inbox entries
    {
      $match: {
        inboxEntry: { $size: 0 }
      }
    },
    
    // Return only task IDs
    {
      $project: {
        _id: 1
      }
    }
  ];

  const tasks = await TaskInbox.aggregate(pipeline);
  return tasks.map(task => task._id.toString());
};

exports.TaskInbox = TaskInbox;