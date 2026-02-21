"use strict";

const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");
const { CUSTOM_FIELD_TYPES } = require("../utils/constants");

const customFieldSchema = new Schema({
  name: { type: String, required: true },
  type: {
    type: String,
    required: true,
    enum: Object.values(CUSTOM_FIELD_TYPES),
  },
  value: { type: Schema.Types.Mixed },
  options: {
    type: [String],
    validate: {
      validator: function (options) {
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

const subtaskSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  taskId: { type: Types.ObjectId, ref: "Task", required: true },
  projectId: { type: Types.ObjectId, ref: "Project", required: false },
  companyId: { type: Types.ObjectId, ref: "Company", required: false, index: true },
  createdBy: { type: Types.ObjectId, ref: "User", required: true },
  assignedTo: [{ type: Types.ObjectId, ref: "User" }],
  status: { type: String, default: "todo" },
  priority: { type: String, default: "medium" },
  dueDate: { type: Date },
  tags: [{ type: String }],
  strokeColor: { type: String, default: "#6C63FF" },
  type: { type: String, default: "task" },
  isActive: { type: Boolean, default: true },
  isCompleted: { type: Boolean, default: false },
  attachments: [
    {
      url: { type: String, required: true },
      fileName: { type: String },
      fileSize: { type: Number },
      mimeType: { type: String },
      uploadedBy: { type: Types.ObjectId, ref: "User" },
      uploadedAt: { type: Date, default: Date.now },
      source: {
        type: String,
        enum: ["local", "google_drive", "dropbox"],
        default: "local",
      },
      cloudFileId: { type: String },
      cloudIntegrationId: { type: Types.ObjectId, ref: "CloudIntegration" },
      webViewLink: { type: String },
      thumbnailLink: { type: String },
    },
  ],
  links: [{ type: String }],
  customFields: [customFieldSchema],
  checklist: { type: [checklistItemSchema], default: [] },
  orderIndex: {
    type: Map,
    of: Number,
    default: () => new Map([["todo", 1000]]),
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Sync isCompleted with status on save
subtaskSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.isCompleted = this.status === "completed";
  }
  next();
});

// Sync isCompleted with status on findOneAndUpdate
subtaskSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  if (update.status !== undefined) {
    update.isCompleted = update.status === "completed";
  } else if (update.$set && update.$set.status !== undefined) {
    update.$set.isCompleted = update.$set.status === "completed";
  }
  next();
});

// register pagination plugin to subtask model
subtaskSchema.plugin(mongoosePaginate);
subtaskSchema.plugin(aggregatePaginate);

const SubtaskModel = model("Subtask", subtaskSchema);

// create new subtask
exports.createSubtask = (obj) => SubtaskModel.create(obj);

// find subtask by query
exports.findSubtask = (query) => SubtaskModel.findOne(query);

// find subtask with populated assignedTo
exports.findSubtaskPopulated = (query) =>
  SubtaskModel.findOne(query).populate(
    "assignedTo",
    "name email title designation image coverImage description dob gender nickname role"
  );

// update subtask by query
exports.updateSubtask = (query, update, options = {}) =>
  SubtaskModel.findOneAndUpdate(query, update, { new: true, ...options });

// delete subtask by query
exports.deleteSubtask = (query) => SubtaskModel.findOneAndDelete(query);

// get all subtasks
exports.getAllSubtasks = async ({
  query,
  page,
  limit,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: SubtaskModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};
