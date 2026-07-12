"use strict";

const CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL  = process.env.FRONTEND_URL;

const API_BASE_URL   = "https://api.github.com";
const AUTH_BASE_URL  = "https://github.com/login/oauth/authorize";
const TOKEN_URL      = "https://github.com/login/oauth/access_token";

// Low-level authenticated REST helper. Throws { statusCode, message } on failure.
const githubFetch = async (path, token, options = {}) => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization:        `Bearer ${token}`,
      Accept:                "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `GitHub API error: ${body.message || res.statusText}` };
  }
  return res.json();
};

const GRAPHQL_URL = "https://api.github.com/graphql";

// Low-level GraphQL helper for Projects v2 access. Throws { statusCode, message } on failure.
const githubGraphql = async (token, query, variables = {}) => {
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
    throw { statusCode: 400, message: `GitHub GraphQL error: ${body.message || res.statusText}` };
  }
  const data = await res.json();
  if (data.errors && data.errors.length > 0) {
    throw { statusCode: 400, message: `GitHub GraphQL error: ${data.errors[0].message}` };
  }
  return data.data;
};

// Returns all Projects v2 boards visible to the token: the user's own + every org they belong to.
exports.listProjects = async (token) => {
  const data = await githubGraphql(token, `
    query {
      viewer {
        login
        projectsV2(first: 50) {
          nodes { id title number }
        }
        organizations(first: 25) {
          nodes {
            login
            projectsV2(first: 50) {
              nodes { id title number }
            }
          }
        }
      }
    }
  `);

  const projects = [];
  for (const node of (data.viewer.projectsV2 && data.viewer.projectsV2.nodes) || []) {
    projects.push({ id: node.id, title: node.title, number: node.number, ownerLogin: data.viewer.login });
  }
  for (const org of (data.viewer.organizations && data.viewer.organizations.nodes) || []) {
    for (const node of (org.projectsV2 && org.projectsV2.nodes) || []) {
      projects.push({ id: node.id, title: node.title, number: node.number, ownerLogin: org.login });
    }
  }
  return projects;
  // Returns: [{ id, title, number, ownerLogin }]
  // id is the GraphQL node ID (opaque string), NOT the numeric project number
};

// Returns the project's single-select fields (for Status resolution) plus one page of items.
// Returns: { fields: [{id,name,options:[{id,name,color}]}], items: [...], hasMore, endCursor }
exports.getProjectItems = async (token, projectId, cursor = null) => {
  const data = await githubGraphql(token, `
    query($projectId: ID!, $after: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name color }
              }
            }
          }
          items(first: 50, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField { name }
                    }
                  }
                }
              }
              content {
                __typename
                ... on Issue {
                  title
                  body
                  milestone { dueOn }
                  labels(first: 20) { nodes { name } }
                }
                ... on DraftIssue {
                  title
                  body
                }
              }
            }
          }
        }
      }
    }
  `, { projectId, after: cursor || null });

  const project = data.node;
  const fields = ((project.fields && project.fields.nodes) || [])
    .filter((f) => f && f.options) // only single-select fields have `options`
    .map((f) => ({ id: f.id, name: f.name, options: f.options }));

  const items = ((project.items && project.items.nodes) || []).map((item) => ({
    id:          item.id,
    fieldValues: (item.fieldValues && item.fieldValues.nodes) || [],
    content:     item.content,
  }));

  const pageInfo = (project.items && project.items.pageInfo) || {};
  return {
    fields,
    items,
    hasMore:   pageInfo.hasNextPage || false,
    endCursor: pageInfo.endCursor   || null,
  };
};

exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/github/callback`);
  const scope       = encodeURIComponent("repo read:project");
  return `${AUTH_BASE_URL}?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&scope=${scope}`;
};

// GitHub's token endpoint returns application/x-www-form-urlencoded by default.
// Accept: application/json is REQUIRED or res.json() will throw a parse error.
exports.exchangeCode = async (code) => {
  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Accept:         "application/json",
    },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri:  `${FRONTEND_URL}/github/callback`,
    }),
  });
  if (!res.ok) {
    throw { statusCode: 400, message: `GitHub OAuth error: ${res.statusText}` };
  }
  const data = await res.json();
  if (data.error) {
    throw { statusCode: 400, message: `GitHub OAuth error: ${data.error_description || data.error}` };
  }
  return data;
  // Returns: { access_token, token_type: "bearer", scope }
  // NOTE: no expires_in, no refresh_token — classic OAuth App tokens do not expire
};

exports.getMe = async (token) => {
  const data = await githubFetch("/user", token);
  return { id: data.id, login: data.login, name: data.name || data.login };
};

exports.listRepos = async (token) => {
  const repos = [];
  let page = 1;
  while (true) {
    const data = await githubFetch(`/user/repos?per_page=100&page=${page}&sort=updated`, token);
    for (const r of data) {
      repos.push({ id: r.id, fullName: r.full_name, name: r.name, private: r.private });
    }
    if (data.length < 100) break;
    page++;
  }
  return repos;
  // Returns: [{ id, fullName, name, private }]
};

exports.getRepoIssues = async (token, owner, repo, page = 1) => {
  const data = await githubFetch(
    `/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}&sort=created&direction=asc`,
    token
  );
  // The Issues API also returns pull requests — filter those out.
  const issues = data.filter((item) => !item.pull_request);
  return {
    issues,
    hasMore: data.length === 100,
  };
};

// Extract GitHub-hosted image/file URLs from an issue body's raw markdown.
// Handles the legacy public image format and both current user-attachments
// formats: /assets/{uuid} (drag-drop images) and /files/{id}/{filename} (file uploads).
// Returns deduplicated array of URL strings.
exports.extractAttachmentUrls = (body) => {
  if (!body) return [];
  const legacyRegex  = /https:\/\/user-images\.githubusercontent\.com\/[^\s)"'>]+/g;
  const currentRegex = /https:\/\/github\.com\/user-attachments\/(?:assets|files)\/[^\s)"'>]+/g;
  const matches = [
    ...(body.match(legacyRegex) || []),
    ...(body.match(currentRegex) || []),
  ];
  return [...new Set(matches)];
};
