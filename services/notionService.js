"use strict";

const CLIENT_ID     = process.env.NOTION_CLIENT_ID;
const CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET;
const FRONTEND_URL  = process.env.FRONTEND_URL;

const BASE_API_URL   = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

// 60-day default expiry in ms (used when Notion omits expires_in)
const DEFAULT_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

// ─── Private helpers ──────────────────────────────────────────────────────────

const basicAuthHeader = () =>
  "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

const notionFetch = async (path, token, options = {}) => {
  const url = `${BASE_API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization:    `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type":   "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Notion API error: ${body.message || res.statusText}` };
  }
  return res.json();
};

// ─── OAuth ────────────────────────────────────────────────────────────────────

// Returns the URL to redirect the user to for Notion OAuth.
// After approval, Notion delivers ?code=... to FRONTEND_URL/notion/callback.
exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/notion/callback`);
  return `${BASE_API_URL}/oauth/authorize?owner=user&client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code`;
};

// Exchanges an authorization code for tokens.
// Returns: { access_token, refresh_token, bot_id, workspace_id, workspace_name, owner: { person: { email }, name } }
// NOTE: Notion may NOT return expires_in. If absent, use DEFAULT_EXPIRY_MS (60 days).
exports.exchangeCode = async (code) => {
  const redirectUri = `${FRONTEND_URL}/notion/callback`;
  const res = await fetch(`${BASE_API_URL}/oauth/token`, {
    method:  "POST",
    headers: {
      Authorization:    basicAuthHeader(),
      "Content-Type":   "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      grant_type:   "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Notion OAuth error: ${body.error || body.message || res.statusText}` };
  }
  const data = await res.json();
  if (!data.expires_in) {
    data.expires_in = DEFAULT_EXPIRY_MS / 1000; // normalise to seconds for callers
  }
  return data;
};

// Exchanges a refresh token for new tokens.
// Returns: { access_token, refresh_token, expires_in? }
// NOTE: refresh token is rotating — caller must persist BOTH new tokens immediately.
exports.refreshAccessToken = async (refreshToken) => {
  const res = await fetch(`${BASE_API_URL}/oauth/token`, {
    method:  "POST",
    headers: {
      Authorization:    basicAuthHeader(),
      "Content-Type":   "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 401, message: `Notion token refresh failed: ${body.error || body.message || res.statusText}` };
  }
  const data = await res.json();
  if (!data.expires_in) {
    data.expires_in = DEFAULT_EXPIRY_MS / 1000;
  }
  return data;
};

// ─── Search ───────────────────────────────────────────────────────────────────

// Low-level search call. filterValue: "page" | "data_source" | null (all).
// Returns: { results, hasMore, nextCursor }
exports.search = async (token, filterValue, startCursor = null) => {
  const body = { page_size: 100 };
  if (filterValue) body.filter = { value: filterValue, property: "object" };
  if (startCursor) body.start_cursor = startCursor;

  const data = await notionFetch("/search", token, {
    method: "POST",
    body:   JSON.stringify(body),
  });
  return { results: data.results || [], hasMore: data.has_more, nextCursor: data.next_cursor };
};

// ─── Data sources (formerly "databases") ─────────────────────────────────────
// Notion API v2026-03-11 renamed databases → data_sources.
// object field is now "data_source", endpoints use /data_sources/{id}.

// Returns all data sources (databases) the token can access: [{ id, title }]
exports.listDatabases = async (token) => {
  const databases = [];
  let cursor = null;

  do {
    const { results, hasMore, nextCursor } = await exports.search(token, "data_source", cursor);
    for (const item of results) {
      if (item.in_trash || item.is_archived) continue;
      const titleParts = (item.title || []).map((t) => t.plain_text).filter(Boolean);
      databases.push({ id: item.id, title: titleParts.join("") || "Untitled" });
    }
    cursor = hasMore ? nextCursor : null;
  } while (cursor);

  return databases;
};

// ─── Pages ────────────────────────────────────────────────────────────────────

// Returns standalone (non-database-row) pages: [{ id, title }]
// Filters out rows inside data sources (parent.type === "data_source_id")
// and rows inside old-style databases (parent.type === "database_id").
exports.listStandalonePages = async (token) => {
  const pages = [];
  let cursor = null;

  do {
    const { results, hasMore, nextCursor } = await exports.search(token, "page", cursor);
    for (const page of results) {
      if (page.in_trash || page.is_archived || page.archived) continue;
      const parentType = page.parent && page.parent.type;
      if (parentType === "database_id" || parentType === "data_source_id") continue;

      // Title lives in properties.title or properties.Name (title-type property)
      const props = page.properties || {};
      let title = "";
      const titleProp = props.title || props.Name;
      if (titleProp && titleProp.title) {
        title = titleProp.title.map((t) => t.plain_text).join("").trim();
      }

      pages.push({ id: page.id, title: title || "Untitled" });
    }
    cursor = hasMore ? nextCursor : null;
  } while (cursor);

  return pages;
};

// ─── Data source schema + rows ────────────────────────────────────────────────

// Returns the full data source schema (use .properties to read field types/options).
exports.getDatabase = async (token, dataSourceId) => {
  return notionFetch(`/data_sources/${dataSourceId}`, token);
};

// Returns one page of data source rows.
// Returns: { rows, hasMore, nextCursor }
exports.queryDatabase = async (token, dataSourceId, startCursor = null) => {
  const body = { page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;

  const data = await notionFetch(`/data_sources/${dataSourceId}/query`, token, {
    method: "POST",
    body:   JSON.stringify(body),
  });
  return { rows: data.results || [], hasMore: data.has_more, nextCursor: data.next_cursor };
};

// ─── Page content ─────────────────────────────────────────────────────────────

// Returns the markdown string for a page (requires "read content" capability).
// Notion returns JSON: { object: "pagemarkdown", markdown: "# ..." } — extract the field.
// Returns "" on any failure.
exports.getPageMarkdown = async (token, pageId) => {
  try {
    const url = `${BASE_API_URL}/pages/${pageId}/markdown`;
    const res = await fetch(url, {
      headers: {
        Authorization:    `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    if (!res.ok) return "";
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      return parsed.markdown || "";
    } catch (_) {
      return text; // fallback: endpoint returned raw text
    }
  } catch (_) {
    return "";
  }
};

// ─── Property-extraction utilities ───────────────────────────────────────────

// Find the title-type property and join its plain_text segments.
exports.getTitleValue = (properties) => {
  for (const key of Object.keys(properties || {})) {
    const prop = properties[key];
    if (prop.type === "title" && Array.isArray(prop.title)) {
      return prop.title.map((t) => t.plain_text || "").join("").trim();
    }
  }
  return "";
};

// Find a status or select property and return the name.
// Prefers "status" type; falls back to "select" type.
exports.getStatusName = (properties) => {
  let selectFallback = null;
  for (const key of Object.keys(properties || {})) {
    const prop = properties[key];
    if (prop.type === "status" && prop.status) return prop.status.name || null;
    if (prop.type === "select" && prop.select && selectFallback === null) {
      selectFallback = prop.select.name || null;
    }
  }
  return selectFallback;
};

// Find the first date-type property and return its start value (ISO string or null).
exports.getDueDate = (properties) => {
  for (const key of Object.keys(properties || {})) {
    const prop = properties[key];
    if (prop.type === "date" && prop.date) return prop.date.start || null;
  }
  return null;
};

// Find a select-type property whose key name lowercased === "priority" and return its name.
exports.getPriorityName = (properties) => {
  for (const key of Object.keys(properties || {})) {
    if (key.toLowerCase() === "priority") {
      const prop = properties[key];
      if (prop.type === "select" && prop.select) return prop.select.name || null;
    }
  }
  return null;
};

// Find the first people-type property and return an array of email strings.
exports.getPeopleEmails = (properties) => {
  for (const key of Object.keys(properties || {})) {
    const prop = properties[key];
    if (prop.type === "people" && Array.isArray(prop.people)) {
      return prop.people.map((p) => p.person && p.person.email).filter(Boolean);
    }
  }
  return [];
};

// Find the first files-type property and return normalised file objects.
// Each item: { name, type: "external"|"file", url }
exports.getFiles = (properties) => {
  for (const key of Object.keys(properties || {})) {
    const prop = properties[key];
    if (prop.type === "files" && Array.isArray(prop.files)) {
      return prop.files.map((f) => ({
        name: f.name || "",
        type: f.type,
        url:  f.type === "external" ? (f.external && f.external.url) : (f.file && f.file.url),
      }));
    }
  }
  return [];
};

// From a database schema object, return its status or select options as
// [{ name, isCompleted }]. For a real "status" property, isCompleted is
// resolved from Notion's built-in "Complete" group via option_ids — select
// properties have no group concept, so isCompleted is always false for them.
exports.getDatabaseStatusOptions = (database) => {
  const props = (database && database.properties) || {};
  let selectFallback = null;
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop.type === "status" && prop.status && Array.isArray(prop.status.options)) {
      const groups = Array.isArray(prop.status.groups) ? prop.status.groups : [];
      const completeGroup = groups.find((g) => (g.name || "").toLowerCase() === "complete");
      const completeOptionIds = new Set(
        completeGroup && Array.isArray(completeGroup.option_ids) ? completeGroup.option_ids : []
      );
      return prop.status.options.map((o) => ({ name: o.name, isCompleted: completeOptionIds.has(o.id) }));
    }
    if (prop.type === "select" && prop.select && Array.isArray(prop.select.options) && selectFallback === null) {
      selectFallback = prop.select.options.map((o) => ({ name: o.name, isCompleted: false }));
    }
  }
  return selectFallback || [];
};

// ─── Text utilities ───────────────────────────────────────────────────────────

// Strip markdown syntax to plain text and collapse whitespace.
exports.stripMarkdown = (md) => {
  if (!md) return "";
  return md
    // Convert [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Remove headings #
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic *** ** * ___ __ _
    .replace(/(\*{1,3}|_{1,3})/g, "")
    // Remove inline code backticks
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    // Remove blockquote >
    .replace(/^>\s+/gm, "")
    // Remove unordered list markers - * +
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // Remove ordered list markers 1.
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Remove Notion checkbox syntax [ ] and [x]
    .replace(/\[[x ]?\]/gi, "")
    // Strip XML-like placeholder tags Notion emits for unsupported blocks
    // e.g. <empty-block/>, <unknown url="..." alt="..."/>, <pdf src="..."></pdf>
    .replace(/<[^>]+>/g, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
};

// Map a Notion priority name → Boardd priority.
exports.mapPriority = (priorityName) => {
  const name = (priorityName || "").toLowerCase();
  if (name === "urgent" || name === "high") return "high";
  if (name === "low") return "low";
  return "medium";
};

module.exports = exports;
