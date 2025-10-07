const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

// Schema for team card members with additional properties
const teamMemberSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    memberEmail: { type: String, required: true }, // Member's email
    memberName: { type: String, required: true }, // Member's name
    category: { type: String, required: true }, // e.g., "Engineering", "Management"
    designation: { type: String, default: "" }, // e.g., "CEO", "CTO", "Manager"
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const teamCardSchema = new Schema({
  companyId: { type: Types.ObjectId, ref: "Company", required: true },
  title: { type: String, required: true }, // e.g., "Board of Directors"
  members: [teamMemberSchema], // Team members with their properties
  position: { type: Number, default: 0 }, // For ordering cards
  isActive: { type: Boolean, default: true },
  createdBy: { type: Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Ensure unique position within a company
teamCardSchema.index({ companyId: 1, position: 1 }, { unique: true });

teamCardSchema.plugin(mongoosePaginate);
teamCardSchema.plugin(aggregatePaginate);

const TeamCard = model("TeamCard", teamCardSchema);

// Create a team card
exports.createTeamCard = (obj) => TeamCard.create(obj);

// Find team card by query
exports.findTeamCard = (query) => TeamCard.findOne(query);

// Update team card
exports.updateTeamCard = (query, obj, options = { new: true }) =>
  TeamCard.findOneAndUpdate(query, obj, options);

// Update team card with timestamp
exports.updateTeamCardWithTimestamp = (query, updateData, options = { new: true }) => {
  const updateWithTimestamp = {
    ...updateData,
    updatedAt: new Date(),
  };
  return TeamCard.findOneAndUpdate(query, updateWithTimestamp, options);
};

// Get all team cards
exports.getAllTeamCards = async ({
  query,
  page,
  limit,
  responseKey = "data",
  sort = { position: 1 }, // Default sort by position
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: TeamCard,
    query,
    page,
    limit,
    sort,
  });
  return { [responseKey]: data, pagination };
};

// Delete team card
exports.deleteTeamCard = (query) => TeamCard.findOneAndDelete(query);

// Get next position for ordering
exports.getNextPosition = async (companyId) => {
  // Check ALL cards (not just active) to avoid unique index conflicts
  const highestCard = await TeamCard.findOne({ companyId })
    .sort({ position: -1 })
    .select("position");
  return highestCard ? highestCard.position + 1 : 1;
};

// Add member to team card with additional properties
exports.addMemberToCard = async (cardId, memberData) => {
  const { userId, memberEmail, memberName, category, designation } = memberData;

  // Check if member already exists
  const existingCard = await TeamCard.findOne({
    _id: cardId,
    "members.userId": userId,
  });

  if (existingCard) {
    throw new Error("Member already exists in this team card");
  }

  return TeamCard.findByIdAndUpdate(
    cardId,
    {
      $push: {
        members: {
          userId,
          memberEmail,
          memberName,
          category,
          designation: designation || "",
          addedAt: new Date(),
        },
      },
      updatedAt: new Date(),
    },
    { new: true }
  );
};

// Remove member from team card
exports.removeMemberFromCard = async (cardId, userId) => {
  return TeamCard.findByIdAndUpdate(
    cardId,
    {
      $pull: { members: { userId: userId } },
      updatedAt: new Date(),
    },
    { new: true }
  );
};

// Update member in team card
exports.updateMemberInCard = async (cardId, userId, updateData) => {
  const updateFields = {};
  if (updateData.designation !== undefined)
    updateFields["members.$.designation"] = updateData.designation;
  if (updateData.category !== undefined)
    updateFields["members.$.category"] = updateData.category;
  if (updateData.memberName !== undefined)
    updateFields["members.$.memberName"] = updateData.memberName;
  if (updateData.memberEmail !== undefined)
    updateFields["members.$.memberEmail"] = updateData.memberEmail;

  return TeamCard.findOneAndUpdate(
    { _id: cardId, "members.userId": userId },
    {
      $set: updateFields,
      updatedAt: new Date(),
    },
    { new: true }
  );
};
