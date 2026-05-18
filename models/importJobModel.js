"use strict";

const { Schema, model, Types } = require("mongoose");

const importJobSchema = new Schema(
  {
    userId:   { type: Types.ObjectId, ref: "User", required: true, index: true },
    platform: { type: String, enum: ["clickup", "trello", "asana"], required: true },
    status:   { type: String, enum: ["pending", "running", "completed", "failed"], default: "pending" },
    progress: {
      current:     { type: Number, default: 0 },
      total:       { type: Number, default: 0 },
      currentItem: { type: String, default: "" },
    },
    result: { type: Schema.Types.Mixed },
    error:  { type: String },
  },
  { timestamps: true }
);

const ImportJob = model("ImportJob", importJobSchema);

exports.createImportJob  = (obj) => ImportJob.create(obj);
exports.findImportJob    = (query) => ImportJob.findOne(query);
exports.updateImportJob  = (query, update) =>
  ImportJob.findOneAndUpdate(query, { ...update, updatedAt: new Date() }, { new: true });
