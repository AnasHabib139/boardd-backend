"use strict";

const TRELLO_BASE = "https://api.trello.com/1";
const API_KEY = process.env.TRELLO_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;

const trelloFetch = async (path, token) => {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${TRELLO_BASE}${path}${separator}key=${API_KEY}&token=${token}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw { statusCode: 400, message: `Trello API error: ${text}` };
  }
  return res.json();
};

exports.getAuthUrl = () => {
  const returnUrl = encodeURIComponent(`${FRONTEND_URL}/trello/callback`);
  return (
    `https://trello.com/1/authorize` +
    `?key=${API_KEY}` +
    `&name=Boardd` +
    `&scope=read` +
    `&expiration=never` +
    `&response_type=token` +
    `&callback_method=fragment` +
    `&return_url=${returnUrl}`
  );
};

exports.validateToken = (token) =>
  trelloFetch("/members/me?fields=id,fullName,username,email", token);

exports.getMemberBoards = (token) =>
  trelloFetch("/members/me/boards?fields=id,name,desc,closed&filter=open", token);

exports.getBoardInfo = (token, boardId) =>
  trelloFetch(`/boards/${boardId}?fields=id,name,desc`, token);

exports.getBoardLists = (token, boardId) =>
  trelloFetch(`/boards/${boardId}/lists?filter=open&fields=id,name,pos`, token);

exports.getBoardCards = (token, boardId) =>
  trelloFetch(
    `/boards/${boardId}/cards` +
      `?filter=open` +
      `&members=true` +
      `&checklists=all` +
      `&attachments=true` +
      `&fields=id,name,desc,due,idList,idMembers,labels,pos,closed,checklists,attachments`,
    token
  );

exports.getBoardMembers = (token, boardId) =>
  trelloFetch(`/boards/${boardId}/members?fields=id,fullName,username,email`, token);
