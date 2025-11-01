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

    // WhatsApp Embedded Signup Configuration (Meta OAuth)
    whatsappEmbeddedSignup: {
      // WABA (WhatsApp Business Account) details
      wabaId: {
        type: String,
        default: null,
        index: true
      },

      // Meta OAuth tokens (ENCRYPTED)
      accessToken: {
        type: String,
        default: null,
        select: false  // Don't return by default
      },
      tokenExpiresAt: {
        type: Date,
        default: null
      },

      // Business details from Meta
      businessId: {
        type: String,
        default: null
      },
      businessName: {
        type: String,
        default: null
      },

      // Phone numbers linked to WABA
      phoneNumbers: [{
        phoneNumber: { type: String },              // E.164: '+15551234567'
        phoneNumberId: { type: String },            // Meta's phone number ID
        displayName: { type: String },              // Formatted display name
        verifiedName: { type: String },             // Business verified name
        nameStatus: {                               // Name verification status
          type: String,
          enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'],
          default: 'NONE'
        },
        codeVerificationStatus: {                   // OTP verification status
          type: String,
          enum: ['NOT_VERIFIED', 'VERIFIED'],
          default: 'NOT_VERIFIED'
        },
        qualityRating: {                            // WhatsApp quality rating
          type: String,
          enum: ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'],
          default: 'UNKNOWN'
        },
        registeredAt: { type: Date }
      }],

      // Verification status
      verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'rejected'],
        default: 'pending'
      },

      // Timestamps
      registeredAt: { type: Date },
      lastSyncedAt: { type: Date }
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
