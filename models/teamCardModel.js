const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

// Schema for hashtags with colors
const hashtagSchema = new Schema(
  {
    text: { type: String, required: true, maxlength: 50 }, // Hashtag text
    color: { type: String, default: "#6C63FF" }, // Hashtag background color
    textColor: { type: String, default: "#FFFFFF" }, // Hashtag text color
  },
  { _id: false }
);

// Schema for team card members with additional properties
const teamMemberSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    designation: { type: String, default: "" }, // e.g., "CEO", "CTO", "Manager"
    hashtags: [hashtagSchema], // Array of hashtag objects with colors
    backgroundColor: { type: String, default: "#6C63FF" }, // Member card background color
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
  const highestCard = await TeamCard.findOne({ companyId, isActive: true })
    .sort({ position: -1 })
    .select("position");
  return highestCard ? highestCard.position + 1 : 1;
};

// Add member to team card with additional properties
exports.addMemberToCard = async (cardId, memberData) => {
  const { userId, designation, hashtags, backgroundColor } = memberData;

  // Check if member already exists
  const existingCard = await TeamCard.findOne({
    _id: cardId,
    "members.userId": userId,
  });

  if (existingCard) {
    throw new Error("Member already exists in this team card");
  }

  // Process hashtags
  const processedHashtags = (hashtags || []).map((hashtag) => ({
    text: hashtag.text || "",
    color: hashtag.color || "#6C63FF",
    textColor: hashtag.textColor || "#FFFFFF",
  }));

  return TeamCard.findByIdAndUpdate(
    cardId,
    {
      $push: {
        members: {
          userId,
          designation: designation || "",
          hashtags: processedHashtags,
          backgroundColor: backgroundColor || "#6C63FF",
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
  if (updateData.backgroundColor !== undefined)
    updateFields["members.$.backgroundColor"] = updateData.backgroundColor;

  // Process hashtags if provided
  if (updateData.hashtags !== undefined) {
    const processedHashtags = (updateData.hashtags || []).map((hashtag) => ({
      text: hashtag.text || "",
      color: hashtag.color || "#6C63FF",
      textColor: hashtag.textColor || "#FFFFFF",
    }));

    updateFields["members.$.hashtags"] = processedHashtags;
  }

  return TeamCard.findOneAndUpdate(
    { _id: cardId, "members.userId": userId },
    {
      $set: updateFields,
      updatedAt: new Date(),
    },
    { new: true }
  );
};
