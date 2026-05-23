"use strict";

const CLIENT_ID     = process.env.MONDAY_CLIENT_ID;
const CLIENT_SECRET = process.env.MONDAY_CLIENT_SECRET;
const FRONTEND_URL  = process.env.FRONTEND_URL;

const mondayFetch = async (query, token, variables = {}) => {
  console.log("[Monday] GraphQL query:", query.trim().slice(0, 120));
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: token, // NO "Bearer" prefix — Monday doesn't use it
      "Content-Type": "application/json",
      "API-Version": "2026-04",
    },
    body: JSON.stringify({ query, variables }),
  });
  console.log("[Monday] HTTP status:", res.status);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[Monday] HTTP error body:", JSON.stringify(body));
    throw { statusCode: 400, message: `Monday API error: ${body.errors?.[0]?.message || res.statusText}` };
  }
  const json = await res.json();
  console.log("[Monday] Response:", JSON.stringify(json).slice(0, 300));
  // GraphQL returns HTTP 200 even on errors — must check json.errors
  if (json.errors?.length) {
    console.error("[Monday] GraphQL errors:", JSON.stringify(json.errors));
    throw { statusCode: 400, message: `Monday API error: ${json.errors[0].message}` };
  }
  return json.data;
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/monday/callback`);
  return `https://auth.monday.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}`;
};

exports.exchangeCode = async (code) => {
  const redirectUri = `${FRONTEND_URL}/monday/callback`;
  const res = await fetch("https://auth.monday.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  redirectUri,
      code,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Monday OAuth error: ${body.error_description || res.statusText}` };
  }
  const data = await res.json();
  console.log("[Monday] Token exchange response keys:", Object.keys(data));
  console.log("[Monday] Token type:", data.token_type, "| Scope:", data.scope);
  return data;
  // Returns: { access_token, token_type, scope }
  // NOTE: no refresh_token — Monday tokens never expire
  // NOTE: no user info — call getMe() separately
};

exports.getMe = async (token) => {
  const data = await mondayFetch(`query { me { id name } }`, token);
  return data.me; // { id, name }
};

// ─── Boards ───────────────────────────────────────────────────────────────────

exports.getBoards = async (token) => {
  const data = await mondayFetch(
    `query { boards(limit: 100, board_kind: public, order_by: created_at) { id name workspace { id name } } }`,
    token
  );
  return data.boards || [];
};

exports.getBoardGroups = async (token, boardId) => {
  const data = await mondayFetch(
    `query { boards(ids: [${boardId}]) { groups { id title color } } }`,
    token
  );
  return data.boards?.[0]?.groups || [];
};

exports.getBoardSubscribers = async (token, boardId) => {
  const data = await mondayFetch(
    `query { boards(ids: [${boardId}]) { subscribers { id email name } } }`,
    token
  );
  return data.boards?.[0]?.subscribers || [];
};

// ─── Items — cursor-based pagination ──────────────────────────────────────────

const ITEM_FIELDS = `
  id name state
  group { id title }
  parent_item { id }
  column_values {
    id type
    value
  }
`;

exports.getItemsPage = async (token, boardId) => {
  const data = await mondayFetch(
    `query {
      boards(ids: [${boardId}]) {
        items_page(limit: 100) {
          cursor
          items { ${ITEM_FIELDS} }
        }
      }
    }`,
    token
  );
  return data.boards?.[0]?.items_page || { cursor: null, items: [] };
};

exports.getNextItemsPage = async (token, cursor) => {
  const data = await mondayFetch(
    `query {
      next_items_page(limit: 100, cursor: "${cursor}") {
        cursor
        items { ${ITEM_FIELDS} }
      }
    }`,
    token
  );
  return data.next_items_page || { cursor: null, items: [] };
};

// ─── Column value parsers ─────────────────────────────────────────────────────

// column_values[type="people"].value = '{"personsAndTeams":[{"id":123,"kind":"person"}]}'
exports.parsePeopleColumn = (columnValue) => {
  if (!columnValue?.value) return [];
  try {
    const parsed = JSON.parse(columnValue.value);
    return parsed.personsAndTeams || [];
  } catch (_) { return []; }
};

// column_values[type="date"].value = '{"date":"2024-01-15","time":null}'
exports.parseDateColumn = (columnValue) => {
  if (!columnValue?.value) return null;
  try {
    const parsed = JSON.parse(columnValue.value);
    return parsed.date || null; // "YYYY-MM-DD" string
  } catch (_) { return null; }
};

// column_values[type="file"].value = '{"files":[{"assetId":123,"name":"file.pdf","url":"...","fileSize":1024,"createdAt":"..."}]}'
exports.parseFileColumn = (columnValue) => {
  if (!columnValue?.value) return [];
  try {
    const parsed = JSON.parse(columnValue.value);
    return (parsed.files || []).map(f => ({
      public_url: f.url,
      name:       f.name,
      file_size:  f.fileSize,
      created_at: f.createdAt,
    }));
  } catch (_) { return []; }
};
