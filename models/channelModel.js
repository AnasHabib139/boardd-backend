const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

const channelSchema = new Schema({
  channelName: { type: String, required: true },
  channelDescription: { type: String, required: true },
  companyId: { type: Types.ObjectId, ref: "Company", required: true },
  isPrivate: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false },
  createdBy: { type: Types.ObjectId, ref: "User", required: true },
  channelToken: { type: String, required: true, unique: true },
  tabs: [{ type: Types.ObjectId, ref: "ChannelTab" }],
  members: [{ type: Types.ObjectId, ref: "User" }],
  files: [
    {
      url: { type: String, required: true },
      fileName: { type: String },
      fileSize: { type: Number },
      mimeType: { type: String },
      uploadedBy: { type: Types.ObjectId, ref: "User" },
      uploadedAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

channelSchema.plugin(mongoosePaginate);
channelSchema.plugin(aggregatePaginate);

const Channel = model("Channel", channelSchema);

//create A CHANNEL
exports.createChannel = (channel) => Channel.create(channel);

//get A CHANNEL
exports.findChannel = (query) => Channel.findOne(query);

// add member to the channel
exports.addMemberToChannel = (query, obj) =>
  Channel.findOneAndUpdate(query, obj, { new: true });

// update channel
exports.updateChannel = (query, update, options = {}) =>
  Channel.findOneAndUpdate(query, update, { new: true, ...options });

// get many channels
exports.findManyChannels = (query) => Channel.find(query);

// get all channels
exports.getAllChannelsDetails = async ({
  query,
  page,
  limit,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: Channel,
    query,
    page,
    limit,
  });

  return { [responseKey]: data, pagination };
};

// add files to channel
exports.addFilesToChannel = async (channelId, filesData) => {
  return Channel.findByIdAndUpdate(
    channelId,
    {
      $push: { files: { $each: filesData } },
      updatedAt: new Date(),
    },
    { new: true }
  );
};

// remove file from channel
exports.removeFileFromChannel = async (channelId, fileId) => {
  return Channel.findByIdAndUpdate(
    channelId,
    {
      $pull: { files: { _id: fileId } },
      updatedAt: new Date(),
    },
    { new: true }
  );
};
