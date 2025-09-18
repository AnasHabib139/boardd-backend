const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const ChannelGroupSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    channelIds: [{ type: Types.ObjectId, ref: "Channel", required: true }],
    companyId: { type: Types.ObjectId, ref: "Company", required: true },
    createdBy: { type: Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Add plugins for pagination
ChannelGroupSchema.plugin(mongoosePaginate);
ChannelGroupSchema.plugin(aggregatePaginate);

const ChannelGroupModel = model("ChannelGroup", ChannelGroupSchema);

// Utility functions
exports.createChannelGroup = (obj) => ChannelGroupModel.create(obj);

exports.findChannelGroup = (query) => ChannelGroupModel.findOne(query);

exports.findManyChannelGroups = (query) => ChannelGroupModel.find(query);

exports.updateChannelGroup = (query, obj) =>
  ChannelGroupModel.findOneAndUpdate(query, obj, { new: true });

exports.deleteChannelGroup = (query) => ChannelGroupModel.findOneAndDelete(query);

exports.getAllChannelGroups = async ({
  query,
  page,
  limit,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: ChannelGroupModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};