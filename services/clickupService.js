"use strict";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const CLIENT_ID = process.env.CLICKUP_CLIENT_ID;
const CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;

const clickupFetch = async (path, token) => {
  const res = await fetch(`${CLICKUP_BASE}${path}`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `ClickUp API error: ${body.err || res.statusText}` };
  }
  return res.json();
};

exports.getAuthUrl = () => {
  const redirectUri = encodeURIComponent(`${FRONTEND_URL}/clickup/callback`);
  return `https://app.clickup.com/api?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}`;
};

exports.exchangeCode = async (code) => {
  const res = await fetch(`${CLICKUP_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { statusCode: 400, message: `ClickUp API error: ${body.err || res.statusText}` };
  }
  return res.json(); // { access_token }
};

exports.getAuthorizedUser = (token) =>
  clickupFetch("/user", token);

exports.getWorkspaces = async (token) => {
  const data = await clickupFetch("/team", token);
  return data.teams || [];
};

exports.getSpaces = async (token, teamId) => {
  const data = await clickupFetch(`/team/${teamId}/space?archived=false`, token);
  return data.spaces || [];
};

exports.getFolders = async (token, spaceId) => {
  const data = await clickupFetch(`/space/${spaceId}/folder?archived=false`, token);
  return data.folders || [];
};

exports.getFolderlessLists = async (token, spaceId) => {
  const data = await clickupFetch(`/space/${spaceId}/list?archived=false`, token);
  return data.lists || [];
};

exports.getFolderLists = async (token, folderId) => {
  const data = await clickupFetch(`/folder/${folderId}/list?archived=false`, token);
  return data.lists || [];
};

exports.getTasksPage = async (token, listId, page = 0) => {
  const data = await clickupFetch(
    `/list/${listId}/task?page=${page}&include_closed=false&subtasks=true`,
    token
  );
  return data.tasks || [];
};

exports.getSpaceMembers = async (token, spaceId) => {
  const data = await clickupFetch(`/space/${spaceId}/member`, token);
  return data.members || [];
};
