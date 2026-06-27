"use strict";

const CLIENT_ID     = process.env.LINEAR_CLIENT_ID;
const CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET;
const FRONTEND_URL  = process.env.FRONTEND_URL;

const GRAPHQL_URL   = "https://api.linear.app/graphql";
const TOKEN_URL     = "https://api.linear.app/oauth/token";
const AUTH_BASE_URL = "https://linear.app/oauth/authorize";

// Low-level GraphQL helper. Throws { statusCode: 400, message: "Linear API error: ..." } on failure.
const graphql = async (token, query, variables = {}) => {
  const res = await fetch(GRAPHQL_URL, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Linear API error: ${body.errors?.[0]?.message || res.statusText}` };
  }
  const data = await res.json();
  if (data.errors && data.errors.length > 0) {
    throw { statusCode: 400, message: `Linear API error: ${data.errors[0].message}` };
  }
  return data.data;
};

exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/linear/callback`);
  return `${AUTH_BASE_URL}?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=read`;
};

exports.exchangeCode = async (code) => {
  const redirectUri = `${FRONTEND_URL}/linear/callback`;
  const body = new URLSearchParams({
    code,
    redirect_uri:  redirectUri,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type:    "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Linear OAuth error: ${err.error_description || err.error || res.statusText}` };
  }
  return res.json();
  // Returns: { access_token, refresh_token, expires_in, token_type, scope }
};

exports.refreshAccessToken = async (refreshToken) => {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type:    "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw { statusCode: 401, message: `Linear token refresh failed: ${err.error_description || err.error || res.statusText}` };
  }
  return res.json();
  // Returns: { access_token, refresh_token, expires_in }
};

exports.getMe = async (token) => {
  const data = await graphql(token, `
    query {
      viewer {
        id
        name
        email
      }
    }
  `);
  return data.viewer;
  // Returns: { id, name, email }
};

exports.listTeams = async (token) => {
  const data = await graphql(token, `
    query {
      teams {
        nodes {
          id
          name
        }
      }
    }
  `);
  return data.teams.nodes || [];
  // Returns: [{ id, name }]
};

exports.getTeamStates = async (token, teamId) => {
  const data = await graphql(token, `
    query TeamStates($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
            color
            position
          }
        }
      }
    }
  `, { teamId });
  const states = (data.team && data.team.states && data.team.states.nodes) || [];
  // Sort by position so TabTaskStatuses preserve Linear's column order
  return states.slice().sort((a, b) => a.position - b.position);
  // Returns: [{ id, name, type, color, position }]
  // type is one of: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
};

exports.getTeamIssues = async (token, teamId, cursor = null) => {
  const data = await graphql(token, `
    query TeamIssues($teamId: String!, $after: String) {
      team(id: $teamId) {
        issues(
          first: 50
          after: $after
          filter: {
            parent: { null: true }
            archivedAt: { null: true }
          }
        ) {
          nodes {
            id
            title
            description
            priority
            dueDate
            state {
              name
            }
            assignee {
              email
            }
            attachments {
              nodes {
                url
                title
                subtitle
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `, { teamId, after: cursor || null });

  const issues   = (data.team && data.team.issues && data.team.issues.nodes) || [];
  const pageInfo = (data.team && data.team.issues && data.team.issues.pageInfo) || {};
  return {
    issues,
    hasMore:   pageInfo.hasNextPage || false,
    endCursor: pageInfo.endCursor   || null,
  };
};

// Map Linear priority integer → Boardd priority string.
// 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
exports.mapPriority = (priority) => {
  if (priority === 1 || priority === 2) return "high";
  if (priority === 4) return "low";
  return "medium"; // 0 (none) and 3 (medium) both map to medium
};

// Extract uploads.linear.app file URLs from an issue description.
// These are actual files (images, PDFs) uploaded directly into Linear.
// Returns deduplicated array of URL strings.
exports.extractLinearFileUrls = (description) => {
  if (!description) return [];
  const regex = /https:\/\/uploads\.linear\.app\/[^\s)"'>]+/g;
  const matches = description.match(regex) || [];
  return [...new Set(matches)];
};
