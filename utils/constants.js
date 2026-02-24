exports.AUTH_PROVIDERS = Object.freeze({
  LOCAL: "local",
  GOOGLE: "google",
});

exports.CONSUMER_DOMAINS = Object.freeze([
  "gmail.com",
  "googlemail.com",
  "google.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
]);

// Backward-compatible alias
exports.BLOCKED_CONSUMER_DOMAINS = exports.CONSUMER_DOMAINS;

exports.isConsumerDomain = (domain) =>
  exports.CONSUMER_DOMAINS.includes(domain?.toLowerCase());

exports.ROLES = Object.freeze({
  ADMIN: "admin",
  EMPLOYEE: "employee",
  DEMO_USER: "demo_user",
  GUEST: "guest",
});

exports.WORK_TYPE = Object.freeze({
  WORK: "work",
  PERSONAL: "personal",
  SCHOOL: "school",
  NONPROFIT: "nonp rofit",
});

exports.CURRENT_ROLE = Object.freeze({
  DIRECTOR: "director",
  TEAM_LEADER: "team leader",
  BUSINESS_OWNER: "business owner",
  TEAM_MEMBER: "team member",
  DESIGNER: "designer",
  FREELANCER: "freelancer",
});

exports.TEAM_QUANTITY = Object.freeze({
  ONLY_ME: "only me",
  TWO_TO_FIVE: "02-05",
  SIX_TO_TEN: "06-10",
  ELEVEN_TO_FIFTEEN: "11-15",
  SIXTEEN_TO_TWENTY_FIVE: "16-25",
  TWENTY_SIX_TO_FIFTY: "26-50",
  FIFTY_ONE_TO_HUNDRED: "51-100",
  ONE_HUNDRED_ONE_TO_FIVE_HUNDRED: "101-500",
});

exports.ORGANIZATION_QUANTITY = Object.freeze({
  ONE_TO_NINETEEN: "1-19",
  TENTY_TO_FOURTY_NINE: "20-49",
  FIFTY_TO_NINETY_NINE: "50-99",
  ONE_HUNDRED_TO_TWO_HUNDRED_FIFTY: "100-250",
  TWO_HUNDRED_FIFTY_ONE_TO_FIVE_HUNDRED: "251-500",
  FIVE_HUNDRED_ONE_TO_ONE_THOUSEND_FIVE_HUNDRED: "501-1500",
  ONE_THOUSEND_FIVE_HUNDRED_PLUS: "1500+",
});

exports.SOURCE = Object.freeze({
  YOUTUBE: "youtube",
  SEARCH_ENGINE: "search engine",
  LINKEDIN: "linkedin",
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  AUDIO_AD: "audio ad",
  OTHER: "other",
});

exports.CHANNEL_PREFERENCE = Object.freeze({
  TASK_MANAGEMENT: "task management",
  CLIENT_MANAGEMENT: "client management",
  FORM_BUILDER: "form builder",
  WORK_IN_PROGRESS: "work in progress",
  TIME_TRACKING: "time tracking",
});

exports.STATUS_CODES = Object.freeze({
  SUCCESS: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  PARTIAL_CONTENT: 206,
});

exports.PRIVACY = Object.freeze({
  PUBLIC: "public",
  PRIVATE: "private",
});

exports.DEFAULT_TABS = Object.freeze({
  TASK_MANAGEMENT: "task management",
  CLIENT_MANAGEMENT: "client management",
  FORMS: "forms",
  PROGRESS: "progress",
  TEAM_CHAT: "team chat",
  FILES: "files",
  CLIENT_CHAT: "client chat",
});

// Define the desired tab order for sorting
exports.TAB_ORDER = Object.freeze({
  "task management": 1,
  "team chat": 2,
  "client chat": 3,
  "client management": 4,
  files: 5,
  forms: 6,
  progress: 7,
  embed: 8,
});

// Tab type enum
exports.TAB_TYPES = Object.freeze({
  DEFAULT: "default",
  EMBED: "embed",
});

// Known embed providers
exports.EMBED_PROVIDERS = Object.freeze([
  "google_sheets",
  "google_docs",
  "google_calendar",
  "google_maps",
  "youtube",
  "figma",
  "custom",
]);

// Custom field type enum
exports.CUSTOM_FIELD_TYPES = Object.freeze({
  NUMBER: "number",
  TEXT: "text",
  DATE: "date",
  TEXTAREA: "textarea",
  CHECKBOX: "checkbox",
  DROPDOWN: "dropdown",
});

exports.PROJECT_COLUMN_TYPES = Object.freeze({
  TEXT: "text",
  DROPDOWN: "dropdown",
  DATE: "date",
  NUMBER: "number",
  LABEL: "label",
  CHECKBOX: "checkbox",
  EMAIL: "email",
  PHONE: "phone",
  LOCATION: "location",
  RATING: "rating",
  VOTING: "voting",
  SIGNATURE: "signature",
});

exports.ACTION_TYPE = Object.freeze({
  CREATE_TASK: "CREATE_TASK",
  UPDATE_TASK: "UPDATE_TASK",
  DELETE_TASK: "DELETE_TASK",
  ARCHIVE_TASK: "ARCHIVE_TASK",
  ADD_COMMENT: "ADD_COMMENT",
  CREATE_SUBTASK: "CREATE_SUBTASK",
  UPDATE_SUBTASK: "UPDATE_SUBTASK",
  DELETE_SUBTASK: "DELETE_SUBTASK",
  ASSIGN_USER: "ASSIGN_USER",
  CHANGE_STATUS: "CHANGE_STATUS",
  CHANGE_PRIORITY: "CHANGE_PRIORITY",
  CHANGE_DUE_DATE: "CHANGE_DUE_DATE",
  ADD_TAG: "ADD_TAG",
  REMOVE_TAG: "REMOVE_TAG",
  ADD_DESCRIPTION: "ADD_DESCRIPTION",
  UPDATE_DESCRIPTION: "UPDATE_DESCRIPTION",
  ADD_STROKE_COLOR: "ADD_STROKE_COLOR",
  UPDATE_STROKE_COLOR: "UPDATE_STROKE_COLOR",
  ADD_CUSTOM_FIELD: "ADD_CUSTOM_FIELD",
  UPDATE_CUSTOM_FIELD: "UPDATE_CUSTOM_FIELD",
  DELETE_CUSTOM_FIELD: "DELETE_CUSTOM_FIELD",
  CREATE_PROJECT: "CREATE_PROJECT",

  // Client action types
  CREATE_CLIENT: "CREATE_CLIENT",
  ADD_CLIENT_DETAILS: "ADD_CLIENT_DETAILS",
  UPDATE_CLIENT_DETAILS: "UPDATE_CLIENT_DETAILS",
  DELETE_CLIENT_DETAILS: "DELETE_CLIENT_DETAILS",
  ADD_CLIENT_PROJECT: "ADD_CLIENT_PROJECT",
  UPDATE_CLIENT_PROJECT: "UPDATE_CLIENT_PROJECT",
  DELETE_CLIENT_PROJECT: "DELETE_CLIENT_PROJECT",

  // Client payment action types
  CLIENT_PAYMENT_ADDED: "CLIENT_PAYMENT_ADDED",
  CLIENT_PAYMENT_REMOVED: "CLIENT_PAYMENT_REMOVED",
  CLIENT_PAYMENT_SET_DEFAULT: "CLIENT_PAYMENT_SET_DEFAULT",

  // Invoice action types
  CREATE_INVOICE: "CREATE_INVOICE",
  UPDATE_INVOICE: "UPDATE_INVOICE",
  FINALIZE_INVOICE: "FINALIZE_INVOICE",
  SEND_INVOICE: "SEND_INVOICE",
  VOID_INVOICE: "VOID_INVOICE",
  DELETE_INVOICE: "DELETE_INVOICE",
  INVOICE_PAID: "INVOICE_PAID",
  INVOICE_PAYMENT_FAILED: "INVOICE_PAYMENT_FAILED",

  // Subscription action types
  CREATE_SUBSCRIPTION: "CREATE_SUBSCRIPTION",
  UPDATE_SUBSCRIPTION: "UPDATE_SUBSCRIPTION",
  CANCEL_SUBSCRIPTION: "CANCEL_SUBSCRIPTION",
  PAUSE_SUBSCRIPTION: "PAUSE_SUBSCRIPTION",
  RESUME_SUBSCRIPTION: "RESUME_SUBSCRIPTION",
  SUBSCRIPTION_RENEWED: "SUBSCRIPTION_RENEWED",
});

// Task status constants
exports.TASK_STATUS = Object.freeze({
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
});

// Special ObjectId for unassigned channel group (runtime group)
// This is a fixed ObjectId that represents the virtual "Unassigned Channels" group
exports.UNASSIGNED_CHANNEL_GROUP_ID = "000000000000000000000000";

// Task priority constants
exports.TASK_PRIORITY = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

// Form builder constants
exports.FORM_FIELD_TYPES = Object.freeze({
  TEXT: "text",
  EMAIL: "email",
  NUMBER: "number",
  TEXTAREA: "textarea",
  SELECT: "select",
  CHECKBOX: "checkbox",
  RADIO: "radio",
  DATE: "date",
  TIME: "time",
  FILE: "file",
  PHONE: "phone",
  URL: "url",
});

exports.FORM_STATUS = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
});

exports.FORM_SHARING = Object.freeze({
  PRIVATE: "private",
  PUBLIC: "public",
  LINK_ONLY: "link_only",
});

exports.FORM_TYPE = Object.freeze({
  FORM: "form",
  TEMPLATE: "template",
  DOCUMENT: "document",
});

exports.TEMPLATE_CATEGORY = Object.freeze({
  FORM: "form",
  DOCUMENT: "document",
  TASK: "task",
});

// Work Progress Contribution Constants
exports.CONTRIBUTION_LEVELS = {
  NONE: { level: 0, min: 0, max: 0, name: "none" },
  LIGHT: { level: 1, min: 1, max: 2, name: "light" },
  MEDIUM: { level: 2, min: 3, max: 5, name: "medium" },
  HIGH: { level: 3, min: 6, max: 10, name: "high" },
  INTENSE: { level: 4, min: 11, max: Infinity, name: "intense" },
};

exports.CONTRIBUTION_TYPES = {
  // Client Progress Activities
  CLIENT_PERSONAL_DETAILS_ADDED: "CLIENT_PERSONAL_DETAILS_ADDED",
  CLIENT_PERSONAL_DETAILS_UPDATED: "CLIENT_PERSONAL_DETAILS_UPDATED",
  CLIENT_ATTACHMENT_UPLOADED: "CLIENT_ATTACHMENT_UPLOADED",
  CLIENT_PROJECT_ADDED: "CLIENT_PROJECT_ADDED",
  CLIENT_PROJECT_UPDATED: "CLIENT_PROJECT_UPDATED",
  CLIENT_CREATED: "CLIENT_CREATED",

  // Company Progress Activities
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_CREATED: "TASK_CREATED",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  PROJECT_CREATED: "PROJECT_CREATED",
  PROJECT_MILESTONE_REACHED: "PROJECT_MILESTONE_REACHED",
};

exports.CONTRIBUTION_CATEGORIES = {
  CLIENT_PROGRESS: "client_progress",
  COMPANY_PROGRESS: "company_progress",
};

exports.CONTRIBUTION_DURATIONS = {
  CURRENT_MONTH: {
    key: "current_month",
    months: 0,
    days: 30,
    name: "Current Month",
  },
  THREE_MONTHS: {
    key: "3months",
    months: 3,
    days: 90,
    name: "3 Months",
  },
  FOUR_MONTHS: {
    key: "4months",
    months: 4,
    days: 120,
    name: "4 Months",
  },
  SIX_MONTHS: {
    key: "6months",
    months: 6,
    days: 180,
    name: "6 Months",
  },
  EIGHT_MONTHS: {
    key: "8months",
    months: 8,
    days: 240,
    name: "8 Months",
  },
  NINE_MONTHS: {
    key: "9months",
    months: 9,
    days: 270,
    name: "9 Months",
  },
  TWELVE_MONTHS: {
    key: "12months",
    months: 12,
    days: 365,
    name: "12 Months",
  },
};
