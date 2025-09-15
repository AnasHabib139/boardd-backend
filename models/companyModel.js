const { Schema, model, Types } = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");
const {
  WORK_TYPE,
  CURRENT_ROLE,
  TEAM_QUANTITY,
  ORGANIZATION_QUANTITY,
  SOURCE,
  CHANNEL_PREFERENCE,
} = require("../utils/constants");

const generalQuestionsSchema = new Schema({
  workType: { type: String, required: true, enum: Object.values(WORK_TYPE) },
  currentRole: {
    type: String,
    required: true,
    enum: Object.values(CURRENT_ROLE),
  },
  peopleQuantityInTeam: {
    type: String,
    required: true,
    enum: Object.values(TEAM_QUANTITY),
  },
  peopleQuantityInOrganization: {
    type: String,
    required: true,
    enum: Object.values(ORGANIZATION_QUANTITY),
  },
  source: { type: String, required: true, enum: Object.values(SOURCE) },
});

const CompanySchema = new Schema(
  {
    name: { type: String, required: true },
    domain: { type: String, required: true, unique: true }, // e.g. workspin.net
    adminUser: { type: Types.ObjectId, ref: "User" },
    joinToken: { type: String, required: true, unique: true }, // e.g. 32-byte hex
    generalQuestions: { type: generalQuestionsSchema, required: false },
    channelPreference: [
      { type: String, required: false, enum: Object.values(CHANNEL_PREFERENCE) },
    ],
    howDidYouHearAboutUs: { type: String, required: false, maxlength: 200 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    automaticSignups: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CompanySchema.plugin(mongoosePaginate);
CompanySchema.plugin(aggregatePaginate);

const CompanyModel = model("Company", CompanySchema);

// make utility functions
exports.createCompany = (obj) => CompanyModel.create(obj);

// find company by query
exports.findCompany = (query) => CompanyModel.findOne(query);

// update company
exports.updateCompany = (query, obj) =>
  CompanyModel.findOneAndUpdate(query, obj, { new: true });

// get all companies
exports.getAllCompanies = async ({
  query,
  page,
  limit,
  responseKey = "data",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: CompanyModel,
    query,
    page,
    limit,
  });
  return { [responseKey]: data, pagination };
};

// delete company
exports.deleteCompany = (query) => CompanyModel.findOneAndDelete(query);
