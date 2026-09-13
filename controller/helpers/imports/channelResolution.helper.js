"use strict";

const { createChannel, updateChannel, findChannel } = require("../../../models/channelModel");
const { createChannelTab, findChannelTab } = require("../../../models/channelTabsModel");
const { createChatConversation } = require("../../../models/chatConversationModel");
const { STATUS_CODES } = require("../../../utils/constants");
const { generateJoinToken } = require("../users/signup.helper");

// Resolves (or creates) the channel + "task management" tab an import should land in.
// Throws { statusCode, message } on failure — callers already wrap handlers in
// try/catch and call next(error), so a thrown plain object reaches next() unchanged.
exports.resolveImportChannel = async ({
  channelId,
  channelName,
  userId,
  companyId,
  platform,
  defaultName,
}) => {
  if (channelId) {
    const channel = await findChannel({ _id: channelId, companyId });
    if (!channel) {
      throw { statusCode: STATUS_CODES.NOT_FOUND, message: "Channel not found" };
    }
    const tab = await findChannelTab({ channelId: channel._id, tabName: "task management" });
    if (!tab) {
      throw {
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Task management tab not found in this channel",
      };
    }
    return { channel, tab, isNewChannel: false };
  }

  const resolvedName = channelName || defaultName;
  const channel = await createChannel({
    channelName: resolvedName,
    channelDescription: `Imported from ${platform}`,
    companyId,
    isPrivate: false,
    createdBy: userId,
    channelToken: generateJoinToken(),
    members: [userId],
  });
  await createChatConversation({
    companyId,
    type: "channel",
    channelId: channel._id,
    participantIds: [],
    participants: [{ userId, lastReadAt: null }],
    createdBy: userId,
  });
  const tab = await createChannelTab({
    channelId: channel._id,
    tabName: "task management",
    isDefault: true,
    members: [userId],
    createdBy: userId,
    companyId,
    isPrivate: false,
  });
  await updateChannel({ _id: channel._id }, { $push: { tabs: tab._id } });

  return { channel, tab, isNewChannel: true };
};
