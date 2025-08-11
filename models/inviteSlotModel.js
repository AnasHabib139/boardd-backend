const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");
const InviteSlotSchema = new Schema({
  companyId: { type: Types.ObjectId, ref: "Company", required: true },
  slot: { type: Number, required: true },
  token: { type: String, required: true, unique: true }, // secret per slot
  used: { type: Boolean, default: false },
  reserved: { type: Boolean, default: false }, // Whether the slot is reserved for someone
  reservedFor: { type: String }, // Email for whom the slot is reserved
  reservedRole: { type: String }, // Role for the reserved user
  reservedAt: { type: Date }, // When the slot was reserved

  // New fields for channel invite support
  isGuestInviteSlot: { type: Boolean, default: false }, // true for guest slots, false for company slots
  channelId: { type: Types.ObjectId, ref: "Channel" }, // Only for channel invites
  inviteType: {
    type: String,
    enum: ["company", "guest"],
    default: "company",
  },

  createdAt: { type: Date, default: Date.now },
});
InviteSlotSchema.index({ companyId: 1, slot: 1 }, { unique: true });

// register pagination plugin to invite slot model
InviteSlotSchema.plugin(mongoosePaginate);
InviteSlotSchema.plugin(aggregatePaginate);

// Pre-save hook to set reservedAt when reserved is true
InviteSlotSchema.pre("save", function (next) {
  if (this.reserved && !this.reservedAt) {
    this.reservedAt = new Date();
  }
  next();
});

const InviteSlotModel = model("InviteSlot", InviteSlotSchema);

//create many invite slots
exports.createManyInviteSlots = (obj) => InviteSlotModel.insertMany(obj);

//find invite slot by query
exports.findInviteSlot = (query) => InviteSlotModel.findOne(query);

//find multiple invite slots by query
exports.findManyInviteSlots = (query) => InviteSlotModel.find(query);

//find first available (unused) invite slot for a company
exports.findAvailableInviteSlot = (query) =>
  InviteSlotModel.findOne({ ...query, used: false, reserved: false }).sort({
    slot: 1,
  });

//update invite slot by query
exports.updateInviteSlot = (query, obj) =>
  InviteSlotModel.findOneAndUpdate(query, obj, { new: true });

//delete invite slot by query
exports.deleteInviteSlot = (query) => InviteSlotModel.findOneAndDelete(query);

//aggregate invite slots
exports.aggregateInviteSlots = (query) => InviteSlotModel.aggregate(query);

// get all invite slots with pagination
exports.getAllInviteSlots = async ({ query, page, limit, responseKey = "data" }) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: InviteSlotModel,
    query,
    page,
    limit,
  });

  return { [responseKey]: data, pagination };
};
