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

exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/github/callback`);
  return `${AUTH_BASE_URL}?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&scope=repo`;
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
// Handles both the legacy public format and the current user-attachments format.
// Returns deduplicated array of URL strings.
exports.extractAttachmentUrls = (body) => {
  if (!body) return [];
  const legacyRegex = /https:\/\/user-images\.githubusercontent\.com\/[^\s)"'>]+/g;
  const currentRegex = /https:\/\/github\.com\/user-attachments\/assets\/[^\s)"'>]+/g;
  const matches = [
    ...(body.match(legacyRegex) || []),
    ...(body.match(currentRegex) || []),
  ];
  return [...new Set(matches)];
};
