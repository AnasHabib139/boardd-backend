"use strict";

const { Router } = require("express");
const {
  addMembersToChannelTab,
  removeMembersFromChannelTab,
  getAllTabsOfChannel,
  getAllTabMembers,
  createNewChannelTab,
  createSelectedChannelTabs,
  toggleChannelTab,
  getDefaultChannelTabsWithPresence,
  createEmbedTab,
  updateEmbedConfig,
} = require("../controller/channelTabsController");
const Auth = require("../middlewares/Auth");
const { checkPermission } = require("../middlewares/checkPermission");
const { ROLES } = require("../utils/constants");
const {
  validateCreateChannelTab,
  validateCreateSelectedChannelTabs,
  validateAddMembersToChannelTab,
  validateRemoveMembersFromChannelTab,
  validateTabIdParam,
  validateGetAllTabsOfChannelQuery,
  validateGetTabMembersQuery,
  validateToggleChannelTab,
  validateCreateEmbedTab,
  validateUpdateEmbedConfig,
  validateEmbedTabIdParam,
} = require("../validation/channelTabsValidation");

class ChannelTabsApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Create new channel tab with validation
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateChannelTab,
      createNewChannelTab
    );

    // Create multiple selected channel tabs with validation
    router.post(
      "/create-selected",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateSelectedChannelTabs,
      createSelectedChannelTabs
    );

    // Add members to channel tab with validation
    router.post(
      "/add-members",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("addRemoveChannelMembers"),
      validateAddMembersToChannelTab,
      addMembersToChannelTab
    );

    // Remove members from channel tab with validation
    router.post(
      "/remove-members",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("addRemoveChannelMembers"),
      validateRemoveMembersFromChannelTab,
      removeMembersFromChannelTab
    );

    // Create embed tab
    router.post(
      "/embed",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateEmbedTab,
      createEmbedTab
    );

    // Update embed config
    router.put(
      "/embed/:tabId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateEmbedTabIdParam,
      validateUpdateEmbedConfig,
      updateEmbedConfig
    );

    // Get all tabs of channel with validation
    router.get(
      "/members",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetAllTabsOfChannelQuery,
      getAllTabsOfChannel
    );

    // Get all tab members with parameter and query validation
    router.get(
      "/:tabId/members",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTabIdParam,
      validateGetTabMembersQuery,
      getAllTabMembers
    );

    // Toggle channel tab (activate/deactivate)
    router.put(
      "/toggle",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("deleteDashboardTabs"),
      validateToggleChannelTab,
      toggleChannelTab
    );

    // Get default channel tabs with presence status
    router.get(
      "/default-presence/:channelId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getDefaultChannelTabsWithPresence
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/channel-tabs";
  }
}

module.exports = ChannelTabsApi;
