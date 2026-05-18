"use strict";

const ASANA_BASE    = "https://app.asana.com/api/1.0";
const CLIENT_ID     = process.env.ASANA_CLIENT_ID;
const CLIENT_SECRET = process.env.ASANA_CLIENT_SECRET;
const FRONTEND_URL  = process.env.FRONTEND_URL;

const asanaFetch = async (path, token) => {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Asana API error: ${body.errors?.[0]?.message || res.statusText}` };
  }
  return res.json();
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/asana/callback`);
  return `https://app.asana.com/-/oauth_authorize?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code`;
};

exports.exchangeCode = async (code) => {
  const redirectUri = `${FRONTEND_URL}/asana/callback`;
  const res = await fetch("https://app.asana.com/-/oauth_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  redirectUri,
      code,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `Asana OAuth error: ${body.error_description || res.statusText}` };
  }
  return res.json();
  // Returns: { access_token, refresh_token, token_type, expires_in, data: { id, name, email } }
};

exports.getAuthorizedUser = async (token) => {
  const data = await asanaFetch("/users/me?opt_fields=gid,name,email", token);
  return data.data; // { gid, name, email }
};

// ─── Workspaces & Projects ────────────────────────────────────────────────────

exports.getWorkspaces = async (token) => {
  const data = await asanaFetch("/workspaces?opt_fields=gid,name", token);
  return data.data || [];
};

exports.getProjects = async (token, workspaceGid) => {
  const data = await asanaFetch(
    `/projects?workspace=${workspaceGid}&archived=false&opt_fields=gid,name,color`,
    token
  );
  return data.data || [];
};

// ─── Per-project resources ────────────────────────────────────────────────────

exports.getSections = async (token, projectGid) => {
  const data = await asanaFetch(
    `/projects/${projectGid}/sections?opt_fields=gid,name`,
    token
  );
  return data.data || [];
};

exports.getProjectMembers = async (token, projectGid) => {
  const data = await asanaFetch(
    `/projects/${projectGid}/members?opt_fields=gid,email,name`,
    token
  );
  return data.data || [];
};

// ─── Tasks — cursor-based pagination ─────────────────────────────────────────

exports.getTasksPage = async (token, projectGid, offset = undefined) => {
  const offsetParam = offset ? `&offset=${encodeURIComponent(offset)}` : "";
  return asanaFetch(
    `/tasks?project=${projectGid}&limit=100` +
    `&opt_fields=gid,name,notes,assignee.email,due_on,tags.name,` +
    `memberships.section.gid,memberships.project.gid,completed,parent.gid` +
    offsetParam,
    token
  );
  // Returns full response: { data: Task[], next_page: { offset, path, uri } | null }
};

// ─── Attachments ──────────────────────────────────────────────────────────────

exports.getAttachments = async (token, taskGid) => {
  const data = await asanaFetch(
    `/attachments?parent=${taskGid}&opt_fields=gid,name,download_url,size,created_at`,
    token
  );
  return data.data || [];
  // download_url is pre-signed S3 — do NOT send Authorization header when downloading
};
