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
    domain: { type: String, required: true }, // e.g. workspin.net or gmail.com
    isConsumerDomain: { type: Boolean, default: false },
    logo: { type: String, required: false }, // URL to company logo image
    adminUser: { type: Types.ObjectId, ref: "User" },
    joinToken: { type: String, required: true, unique: true }, // e.g. 32-byte hex
    generalQuestions: { type: generalQuestionsSchema, required: false },
    channelPreference: [
      { type: String, required: false, enum: Object.values(CHANNEL_PREFERENCE) },
    ],
    howDidYouHearAboutUs: { type: String, required: false, maxlength: 200 },

    // Multi-tenant Twilio Configuration
    twilioConfig: {
      // Subaccount Credentials (ENCRYPTED - use select: false)
      subAccountSid: { type: String, index: true },
      authToken: { type: String, select: false }, // Used for webhook signature verification
      apiKeySid: { type: String }, // Preferred over authToken
      apiKeySecret: { type: String, select: false }, // ENCRYPTED

      // Messaging Service
      messagingServiceSid: { type: String, index: true },

      // Phone Numbers
      fromNumbers: [{ type: String }], // E.164 format: ['+15551234567']
      phoneNumberSids: [{ type: String }], // Twilio SIDs: ['PN...']

      // WhatsApp Senders
      whatsappSenders: [{
        number: { type: String }, // E.164: '+15551234567'
        twilioNumber: { type: String }, // 'whatsapp:+15551234567'
        status: { type: String, enum: ['pending', 'active', 'failed'], default: 'pending' },
        wabaId: { type: String }, // WhatsApp Business Account ID
        failedReason: { type: String }
      }],

      // Compliance
      a2p: {
        brandId: { type: String }, // TrustHub Brand SID
        campaignId: { type: String }, // TrustHub Campaign SID
        status: {
          type: String,
          enum: ['pending', 'approved', 'rejected', 'provisionally-approved'],
          default: 'pending'
        },
        tollFreeVerificationStatus: { type: String }
      },

      // Operational
      active: { type: Boolean, default: false },
      useTwilioSubaccount: { type: Boolean, default: false }, // Migration flag
      lastHealthCheck: { type: Date },
      healthCheckStatus: {
        type: String,
        enum: ['healthy', 'degraded', 'failed'],
        default: 'healthy'
      },
      notes: { type: String }
    },

    // Multi-tenant Email Configuration
    emailConfig: {
      provider: {
        type: String,
        enum: ['sendgrid', 'smtp', 'none'],
        default: 'none'
      },

      // SendGrid Config
      sendgrid: {
        apiKey: { type: String, select: false }, // ENCRYPTED
        fromEmail: { type: String },
        fromName: { type: String },
        domainVerified: { type: Boolean, default: false },
        domainId: { type: String },
        replyTo: { type: String },

        // Multiple senders support
        senders: [{
          email: { type: String, required: true },
          name: { type: String, required: true },
          domain: { type: String, required: true },
          domainVerified: { type: Boolean, default: false },
          domainId: { type: String },
          verifiedAt: { type: Date },
          isDefault: { type: Boolean, default: false }
        }],

        // Inbound subdomain for receiving emails (requires MX records)
        inboundSubdomain: { type: String }, // e.g., "inbound.arcpeak.io"
        inboundParseId: { type: String } // SendGrid inbound parse webhook ID
      },

      // SMTP Config (Nodemailer)
      smtp: {
        host: { type: String },
        port: { type: Number },
        secure: { type: Boolean }, // true for 465, false for other ports
        user: { type: String },
        password: { type: String, select: false }, // ENCRYPTED
        fromEmail: { type: String },
        fromName: { type: String }
      },

      // Inbound Email Parse
      inbound: {
        enabled: { type: Boolean, default: false },
        domain: { type: String }, // e.g., 'chat.company.com'
        parseWebhookUrl: { type: String }
      },

      // Email verification tracking
      verificationStatus: {
        type: String,
        enum: ['none', 'pending', 'pending_domain_authentication', 'verified'],
        default: 'none'
      },
      verifiedAt: { type: Date },
      lastVerificationCheck: { type: Date }
    },

    // WhatsApp Tech Provider Configuration (Meta Tech Provider Program via Twilio)
    whatsappTechProvider: {
      // Customer's WABA (created during their Embedded Signup flow)
      wabaId: { type: String }, // WhatsApp Business Account ID (from Meta)
      businessName: { type: String },

      // WhatsApp Senders registered via Twilio Senders API
      senders: [{
        phoneNumber: { type: String, required: true }, // E.164: '+15551234567'
        twilioNumber: { type: String, required: true }, // 'whatsapp:+15551234567'
        senderSid: { type: String }, // Twilio Sender SID from Senders API
        displayName: { type: String }, // Business display name for this sender
        status: {
          type: String,
          enum: ['pending', 'active', 'failed', 'disabled'],
          default: 'pending'
        },
        statusDetails: { type: String }, // Status message from Twilio
        registeredAt: { type: Date },
        lastStatusCheck: { type: Date },
        failedReason: { type: String }
      }],

      // Meta Business Portfolio info (from Embedded Signup)
      businessPortfolioId: { type: String },

      // Embedded Signup tracking
      signupCompleted: { type: Boolean, default: false },
      signupCompletedAt: { type: Date },

      // Overall status
      active: { type: Boolean, default: false },
      notes: { type: String }
    },

    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    automaticSignups: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CompanySchema.plugin(mongoosePaginate);
CompanySchema.plugin(aggregatePaginate);

// Add indexes for multi-tenant Twilio configuration
CompanySchema.index({ 'twilioConfig.subAccountSid': 1 });
CompanySchema.index({ 'twilioConfig.messagingServiceSid': 1 });
CompanySchema.index({ 'twilioConfig.useTwilioSubaccount': 1, 'twilioConfig.active': 1 });

// Enforce domain uniqueness only for workspace (non-consumer) companies.
// Consumer domain companies (gmail.com, etc.) share the same domain value.
CompanySchema.index(
  { domain: 1 },
  {
    unique: true,
    partialFilterExpression: { isConsumerDomain: { $eq: false } },
    name: "domain_1_non_consumer_unique",
  }
);

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

// find many companies
exports.findManyCompanies = (query) => CompanyModel.find(query);

// delete company
exports.deleteCompany = (query) => CompanyModel.findOneAndDelete(query);
