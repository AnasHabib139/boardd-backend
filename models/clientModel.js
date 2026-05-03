const { Schema, model, Types } = require("mongoose");
const { ROLES } = require("../utils/constants");
const mongoosePaginate = require("mongoose-paginate-v2");
const aggregatePaginate = require("mongoose-aggregate-paginate-v2");
const { getMongooseAggregatePaginatedData } = require("../utils");

// Client details schema
const clientDetailsSchema = new Schema({
  firstName: { type: String },
  lastName: { type: String },
  email: { type: String },
  phone: {
    countryCode: { type: String },
    number: { type: String },
  },
  address: {
    line_1: { type: String },
    line_2: { type: String },
    country: { type: String },
    zipCode: { type: String },
  },
  companyName: { type: String },
  attachments: [{ type: String }],
});

// Simple project schema for client data
const projectSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    attachments: [{ type: String }],
  },
  {
    _id: true,
    timestamps: false,
  }
);

//client schema
const clientSchema = new Schema({
  clientDetails: [{ type: clientDetailsSchema }],
  tabId: { type: Types.ObjectId, ref: "ChannelTab" },
  projects: [projectSchema],

  // Stripe payment information
  stripe: {
    customerId: { type: String, index: true }, // Stripe customer ID (cus_xxx)
    paymentMethods: [
      {
        paymentMethodId: { type: String, required: true }, // pm_xxx
        type: { type: String, required: true }, // 'card', 'us_bank_account'
        card: {
          brand: String, // 'visa', 'mastercard', 'amex'
          last4: String, // Last 4 digits
          expMonth: Number, // 1-12
          expYear: Number, // 2025, 2026, etc.
          funding: String, // 'credit', 'debit', 'prepaid'
        },
        isDefault: { type: Boolean, default: false },
        addedBy: { type: Types.ObjectId, ref: "User" },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    defaultPaymentMethod: String, // pm_xxx ID of default card

    // Invoice references
    invoices: [{ type: Types.ObjectId, ref: "Invoice" }],

    // Subscription references
    subscriptions: [
      {
        subscriptionId: { type: String }, // Stripe subscription ID
        invoiceId: { type: Types.ObjectId, ref: "Invoice" }, // Reference to recurring invoice record
        status: { type: String } // Subscription status
      }
    ]
  },
  companyId: { type: Types.ObjectId, ref: "Company" }, // Link to company for Stripe account lookup

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Index for better query performance
clientSchema.index({ tabId: 1 });

//register pagination plugin to client model
clientSchema.plugin(mongoosePaginate);
clientSchema.plugin(aggregatePaginate);

const ClientModel = model("Client", clientSchema);

// Utility functions for client operations
exports.createClient = (clientData) => ClientModel.create(clientData);

exports.findClient = (query) => ClientModel.findOne(query);

exports.findManyClients = (query) => ClientModel.find(query);

exports.updateClient = (query, updateData, options = {}) =>
  ClientModel.findOneAndUpdate(query, updateData, { new: true, ...options });

exports.deleteClient = (query) => ClientModel.findOneAndDelete(query);

/**
 * Check if a phone (E.164) is already used by any other client in the same company.
 * Phone is stored split as { countryCode, number }; we compose and compare against the candidate.
 */
exports.isClientPhoneAvailable = async (phoneE164, companyId, excludeClientId = null) => {
  const match = { companyId };
  if (excludeClientId) match._id = { $ne: new Types.ObjectId(excludeClientId) };

  const result = await ClientModel.aggregate([
    { $match: match },
    { $unwind: "$clientDetails" },
    {
      $match: {
        "clientDetails.phone.countryCode": { $exists: true, $ne: null, $ne: "" },
        "clientDetails.phone.number": { $exists: true, $ne: null, $ne: "" },
      },
    },
    {
      $project: {
        _id: 1,
        tabId: 1,
        clientDetails: 1,
        composed: {
          $concat: ["$clientDetails.phone.countryCode", "$clientDetails.phone.number"],
        },
      },
    },
    { $match: { composed: phoneE164 } },
    { $limit: 1 },
  ]);

  return {
    available: result.length === 0,
    existingClient: result[0] || null,
  };
};

/**
 * Check if an email is already used by any other client in the same company (case-insensitive).
 */
exports.isClientEmailAvailable = async (email, companyId, excludeClientId = null) => {
  const query = {
    companyId,
    "clientDetails.email": new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  };
  if (excludeClientId) query._id = { $ne: excludeClientId };

  const existingClient = await ClientModel.findOne(query);
  return {
    available: !existingClient,
    existingClient: existingClient || null,
  };
};

// Get all clients with pagination
exports.getAllClients = async ({
  query,
  page,
  limit,
  responseKey = "clients",
}) => {
  const { data, pagination } = await getMongooseAggregatePaginatedData({
    model: ClientModel,
    query,
    page,
    limit,
  });

  return { [responseKey]: data, pagination };
};

// Project specific utility functions
exports.addProject = async (clientId, projectData) => {
  return ClientModel.findByIdAndUpdate(
    clientId,
    {
      $push: { projects: projectData },
      updatedAt: new Date(),
    },
    { new: true }
  );
};

// Payment method utility functions
exports.addPaymentMethod = async (clientId, paymentMethodData) => {
  const updateOperation = {
    $push: { "stripe.paymentMethods": paymentMethodData },
    updatedAt: new Date(),
  };

  // If this payment method is being set as default, also update the defaultPaymentMethod field
  if (paymentMethodData.isDefault) {
    updateOperation.$set = {
      "stripe.defaultPaymentMethod": paymentMethodData.paymentMethodId
    };
  }

  return ClientModel.findByIdAndUpdate(
    clientId,
    updateOperation,
    { new: true }
  );
};

exports.removePaymentMethod = async (clientId, paymentMethodId) => {
  return ClientModel.findByIdAndUpdate(
    clientId,
    {
      $pull: { "stripe.paymentMethods": { paymentMethodId } },
      updatedAt: new Date(),
    },
    { new: true }
  );
};

exports.setDefaultPaymentMethod = async (clientId, paymentMethodId) => {
  // First, unset all isDefault flags
  await ClientModel.updateOne(
    { _id: clientId },
    { $set: { "stripe.paymentMethods.$[].isDefault": false } }
  );

  // Then set the specified payment method as default
  return ClientModel.findByIdAndUpdate(
    clientId,
    {
      $set: {
        "stripe.defaultPaymentMethod": paymentMethodId,
        "stripe.paymentMethods.$[elem].isDefault": true,
        updatedAt: new Date(),
      },
    },
    {
      arrayFilters: [{ "elem.paymentMethodId": paymentMethodId }],
      new: true,
    }
  );
};

exports.updateClientStripeCustomer = async (clientId, customerId) => {
  return ClientModel.findByIdAndUpdate(
    clientId,
    {
      $set: { "stripe.customerId": customerId },
      updatedAt: new Date(),
    },
    { new: true }
  );
};

/**
 * Find all client details for a company (flattened from all tabs)
 * Returns each clientDetails entry as a separate document with tab info
 */
exports.findAllClientDetailsByCompany = async (companyId, { limit = 10, skip = 0 }) => {
  const companyObjectId = new Types.ObjectId(companyId);

  const result = await ClientModel.aggregate([
    {
      $match: { companyId: companyObjectId }
    },
    {
      $unwind: {
        path: "$clientDetails",
        preserveNullAndEmptyArrays: false
      }
    },
    {
      $lookup: {
        from: "channeltabs",
        localField: "tabId",
        foreignField: "_id",
        as: "tabInfo"
      }
    },
    {
      $unwind: {
        path: "$tabInfo",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        _id: "$clientDetails._id",
        firstName: "$clientDetails.firstName",
        lastName: "$clientDetails.lastName",
        email: "$clientDetails.email",
        phone: "$clientDetails.phone",
        address: "$clientDetails.address",
        companyName: "$clientDetails.companyName",
        attachments: "$clientDetails.attachments",
        tab: {
          id: "$tabId",
          name: "$tabInfo.name"
        },
        client: {
          id: "$_id"
        }
      }
    },
    { $skip: skip },
    { $limit: limit }
  ]);

  return result;
};

/**
 * Count all client details entries for a company
 */
exports.countAllClientDetailsByCompany = async (companyId) => {
  const companyObjectId = new Types.ObjectId(companyId);

  const result = await ClientModel.aggregate([
    {
      $match: { companyId: companyObjectId }
    },
    {
      $unwind: {
        path: "$clientDetails",
        preserveNullAndEmptyArrays: false
      }
    },
    {
      $count: "total"
    }
  ]);

  return result.length > 0 ? result[0].total : 0;
};
