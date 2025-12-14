"use strict";

const { Router } = require("express");
const {
  createChannel,
  addUserToChannel,
  removeUserFromChannel,
  getChannelJoiningLink,
  getAllMembersInChannel,
  getAllChannelsOfUser,
  sendChannelInviteEmails,
  joinChannelWithInvite,
  editChannel,
  toggleChannelArchive,
  getArchivedChannels,
  leaveChannel,
  uploadFilesToChannel,
  getChannelFiles,
  deleteChannelFile,
  shareChannelFile,
  getChannelTasksDropdown,
} = require("../controller/channelController");
const Auth = require("../middlewares/Auth");
const { checkPermission, checkAnyPermission } = require("../middlewares/checkPermission");
const { ROLES } = require("../utils/constants");
const {
  validateCreateChannel,
  validateAddUserToChannel,
  validateRemoveUserFromChannel,
  validateGetChannelJoiningLinkQuery,
  validateGetAllMembersInChannelQuery,
  validateGetAllChannelsOfUserQuery,
  validateSendChannelInviteEmails,
  validateJoinChannelWithInvite,
  validateEditChannel,
  validateToggleChannelArchive,
  validateGetArchivedChannelsQuery,
  validateLeaveChannel,
  validateGetChannelFilesQuery,
  validateDeleteChannelFile,
  validateShareChannelFile,
} = require("../validation/channelValidation");

class ChannelApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Create channel with validation
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("createChannels"),
      validateCreateChannel,
      createChannel
    );

    // Add user to channel with validation
    router.put(
      "/add-member",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("addRemoveChannelMembers"),
      validateAddUserToChannel,
      addUserToChannel
    );

    // Remove user from channel (by creator or admin)
    router.delete(
      "/remove-member",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("addRemoveChannelMembers"),
      validateRemoveUserFromChannel,
      removeUserFromChannel
    );

    // Get channel joining link with query validation
    router.get(
      "/joining-link",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetChannelJoiningLinkQuery,
      getChannelJoiningLink
    );

    // Get all members in channel with query validation
    router.get(
      "/members",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetAllMembersInChannelQuery,
      getAllMembersInChannel
    );

    // Get all channels of user with query validation
    router.get(
      "/member/all-channels",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetAllChannelsOfUserQuery,
      getAllChannelsOfUser
    );

    // Send channel invite emails
    router.post(
      "/:channelId/invite/emails",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateSendChannelInviteEmails,
      sendChannelInviteEmails
    );

    // Join channel using invite token
    router.post(
      "/invite/join",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.GUEST]),
      validateJoinChannelWithInvite,
      joinChannelWithInvite
    );

    // Edit channel details
    router.put(
      "/:channelId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("editTeamNameImage"),
      validateEditChannel,
      editChannel
    );

    // Toggle channel archive status
    router.post(
      "/:channelId/archive",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkAnyPermission(["deleteSelfOwnedChannels", "deleteOthersChannels"]),
      validateToggleChannelArchive,
      toggleChannelArchive
    );

    // Get archived channels for user
    router.get(
      "/archived",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetArchivedChannelsQuery,
      getArchivedChannels
    );

    // Leave channel
    router.post(
      "/:channelId/leave",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateLeaveChannel,
      leaveChannel
    );

    // Upload files to channel
    router.post(
      "/:channelId/files",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("uploadFiles"),
      uploadFilesToChannel
    );

    // Get channel files with type filtering
    router.get(
      "/:channelId/files",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetChannelFilesQuery,
      getChannelFiles
    );

    // Delete file from channel
    router.delete(
      "/:channelId/files/:fileId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("deleteFiles"),
      validateDeleteChannelFile,
      deleteChannelFile
    );

    // Share file from channel to chat or task
    router.post(
      "/:channelId/files/share",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("uploadFiles"),
      validateShareChannelFile,
      shareChannelFile
    );

    // Get all tasks for a channel (for dropdown)
    router.get(
      "/:channelId/tasks/dropdown",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getChannelTasksDropdown
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/channels";
  }
}

module.exports = ChannelApi;
