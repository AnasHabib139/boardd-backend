"use strict";

const CLIENT_ID     = process.env.JIRA_CLIENT_ID;
const CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET;
const FRONTEND_URL  = process.env.FRONTEND_URL;

const BASE_AUTH_URL = "https://auth.atlassian.com";
const BASE_API_URL  = "https://api.atlassian.com";

// ─── Private helpers ──────────────────────────────────────────────────────────

const apiUrl = (cloudId, path) =>
  `${BASE_API_URL}/ex/jira/${cloudId}/rest/api/3${path}`;

const jiraFetch = async (url, token, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept:         "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Jira API error: ${body.message || body.errorMessages?.[0] || res.statusText}` };
  }
  return res.json();
};

// ─── OAuth ────────────────────────────────────────────────────────────────────

exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/jira/callback`);
  const scope       = encodeURIComponent("read:jira-work read:jira-user offline_access");
  return `${BASE_AUTH_URL}/authorize?audience=api.atlassian.com&client_id=${CLIENT_ID}&scope=${scope}&redirect_uri=${redirectUri}&response_type=code&prompt=consent`;
};

exports.exchangeCode = async (code) => {
  const redirectUri = `${FRONTEND_URL}/jira/callback`;
  const res = await fetch(`${BASE_AUTH_URL}/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      grant_type:    "authorization_code",
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri:  redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Jira OAuth error: ${body.error_description || res.statusText}` };
  }
  return res.json();
  // Returns: { access_token, refresh_token, expires_in, token_type, scope }
};

exports.refreshAccessToken = async (refreshToken) => {
  const res = await fetch(`${BASE_AUTH_URL}/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 401, message: `Jira token refresh failed: ${body.error_description || res.statusText}` };
  }
  return res.json();
  // Returns: { access_token, refresh_token, expires_in }
  // NOTE: refresh token is rotating — must store the new one immediately
};

// ─── Sites + User ─────────────────────────────────────────────────────────────

exports.getAccessibleResources = async (token) => {
  const res = await fetch(`${BASE_API_URL}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw { statusCode: 400, message: "Failed to fetch Jira sites" };
  return res.json();
  // Returns: [{ id, name, url, scopes, avatarUrl }]  — id is the cloudId
};

exports.getMe = async (token, cloudId) => {
  return jiraFetch(apiUrl(cloudId, "/myself"), token);
  // Returns: { accountId, displayName, emailAddress (GDPR — may be null) }
};

// ─── Projects ─────────────────────────────────────────────────────────────────

exports.getProjects = async (token, cloudId) => {
  const data = await jiraFetch(
    apiUrl(cloudId, "/project/search?maxResults=100&orderBy=name"),
    token
  );
  return data.values || [];
  // Returns: [{ id, key, name, projectTypeKey }]
};

// ─── Statuses ─────────────────────────────────────────────────────────────────

exports.getProjectStatuses = async (token, cloudId, projectId) => {
  const data = await jiraFetch(apiUrl(cloudId, `/project/${projectId}/statuses`), token);
  // Response: [{ id, name, self, statuses: [{ id, name, statusCategory: { key, name } }] }]
  // Grouped by issue type — flatten to unique statuses by id
  const seen     = new Set();
  const statuses = [];
  for (const issueType of data) {
    for (const s of issueType.statuses || []) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        statuses.push({ id: s.id, name: s.name, categoryKey: s.statusCategory?.key || "" });
      }
    }
  }
  return statuses;
};

// ─── Issues (cursor pagination) ───────────────────────────────────────────────

exports.searchIssues = async (token, cloudId, projectKey, nextPageToken = null) => {
  const params = new URLSearchParams({
    jql:        `project = "${projectKey}" AND issuetype not in (Epic, Subtask) ORDER BY created ASC`,
    maxResults: "100",
    fields:     "summary,status,duedate,priority,issuetype,parent,attachment",
    expand:     "renderedFields",
  });
  if (nextPageToken) params.set("nextPageToken", nextPageToken);

  const data = await jiraFetch(apiUrl(cloudId, `/search/jql?${params.toString()}`), token);
  return {
    issues:        data.issues || [],
    nextPageToken: data.nextPageToken || null,
  };
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

// Strip HTML tags from Jira rendered description
exports.stripHtml = (html) => {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

// Map Jira priority name → Boardd priority
exports.mapPriority = (priorityName) => {
  const name = (priorityName || "").toLowerCase();
  if (name === "highest" || name === "high") return "high";
  if (name === "low"     || name === "lowest") return "low";
  return "medium";
};
