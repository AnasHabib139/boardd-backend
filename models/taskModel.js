"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");
const {
  CUSTOM_FIELD_TYPES,
  TASK_STATUS,
} = require("../utils/constants");

const customFieldSchema = new Schema({
  name: { type: String, required: true },
  type: {
    type: String,
    required: true,
    enum: Object.values(CUSTOM_FIELD_TYPES),
  },
  value: { type: Schema.Types.Mixed }, // Can store any type of value
  options: {
    type: [String], // For dropdown type, max 3 options
    validate: {
      validator: function (options) {
        // Only validate if type is dropdown
        return this.type !== CUSTOM_FIELD_TYPES.DROPDOWN || options.length <= 3;
      },
      message: "Dropdown can have maximum 3 options",
    },
  },
});

const checklistItemSchema = new Schema(
  {
    name: { type: String, required: true },
    isCompleted: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const taskSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  projectId: { type: Types.ObjectId, ref: "Project", required: false },
  channelId: { type: Types.ObjectId, ref: "Channel", required: false },
  createdBy: { type: Types.ObjectId, ref: "User", required: true },
  assignedTo: [{ type: Types.ObjectId, ref: "User" }],
  status: {
    type: String,
    enum: Object.values(TASK_STATUS),
    default: TASK_STATUS.TODO,
  },
  priority: {
    type: String,
    default: "medium",
  },
  dueDate: { type: Date },
  tags: [{ type: String }],
  strokeColor: { type: String, default: "#6C63FF" }, // Default purple
  type: { type: String, default: "task" },
  isActive: { type: Boolean, default: true },
  attachments: [{ type: String }],
  links: [{ type: String }],
  customFields: [customFieldSchema], // Add custom fields array
  checklist: { type: [checklistItemSchema], default: [] },

  // Status-specific column values for project list view
  statusColumnValues: {
    type: Map,
    of: Schema.Types.Mixed,
    default: new Map()
  },

  // Order indexes for drag and drop within project categories
  orderIndex: {
    todo: { type: Number, default: 1000 },
    in_progress: { type: Number, default: 1000 },
    completed: { type: Number, default: 1000 },
  },

  version: { type: Number, default: 0 }, // For optimistic locking and conflict resolution
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// register pagination plugin to task model
taskSchema.plugin(mongoosePaginate);
taskSchema.plugin(aggregatePaginate);

const TaskModel = model("Task", taskSchema);

// create new task
exports.createTask = (obj) => TaskModel.create(obj);

// find task by query
exports.findTask = (query) => TaskModel.findOne(query);

//find many tasks by query
exports.findManyTasks = (query) => TaskModel.find(query);

// update task by query
exports.updateTask = (query, update, options = {}) =>
  TaskModel.findOneAndUpdate(query, update, { new: true, ...options });

// delete task by query
exports.deleteTask = (query) => TaskModel.findOneAndDelete(query);

// get all tasks
exports.getAllTasks = async ({ query, page, limit, responseKey = "data" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TaskModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};

// Utility functions for drag and drop ordering

// Calculate next order index for a status in a project or channel
exports.getNextOrderIndex = async (projectId, channelId, status) => {
  const query = projectId 
    ? { projectId, status, isActive: true }
    : { channelId, projectId: null, status, isActive: true };

  const lastTask = await TaskModel.findOne(query).sort({ [`orderIndex.${status}`]: -1 });

  if (!lastTask || !lastTask.orderIndex || !lastTask.orderIndex[status]) {
    return 1000; // Default starting order
  }

  return lastTask.orderIndex[status] + 1000; // Add gap for future insertions
};

// Calculate order index for inserting between two tasks
exports.calculateOrderIndex = (previousOrderIndex, nextOrderIndex) => {
  if (!previousOrderIndex && !nextOrderIndex) {
    return 1000; // Default order
  }

  if (!previousOrderIndex) {
    return Math.max(nextOrderIndex / 2, 1); // Insert before first
  }

  if (!nextOrderIndex) {
    return previousOrderIndex + 1000; // Insert after last
  }

  return (previousOrderIndex + nextOrderIndex) / 2; // Insert between
};

// Update task order index for a specific status
exports.updateTaskOrderIndex = async (taskId, status, newOrderIndex) => {
  const updateField = `orderIndex.${status}`;
  return TaskModel.findByIdAndUpdate(
    taskId,
    {
      $set: { [updateField]: newOrderIndex },
      updatedAt: new Date(),
    },
    { new: true }
  );
};

// Move task to different project and status with new order
exports.moveTaskToProject = async (
  taskId,
  newProjectId,
  newStatus,
  newOrderIndex
) => {
  const updateField = `orderIndex.${newStatus}`;
  return TaskModel.findByIdAndUpdate(
    taskId,
    {
      $set: {
        projectId: newProjectId,
        channelId: null, // Remove channelId when moving to project
        status: newStatus,
        [updateField]: newOrderIndex,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
};

// Move task to channel (Open) with status and new order
exports.moveTaskToChannel = async (
  taskId,
  newChannelId,
  newStatus,
  newOrderIndex
) => {
  const updateField = `orderIndex.${newStatus}`;
  return TaskModel.findByIdAndUpdate(
    taskId,
    {
      $set: {
        channelId: newChannelId,
        projectId: null, // Remove projectId when moving to Open
        status: newStatus,
        [updateField]: newOrderIndex,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
};
