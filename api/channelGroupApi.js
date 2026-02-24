"use strict";

const { Router } = require("express");
const { createChannelGroup, assignChannelsToGroup, getAllChannelGroups, deleteChannelGroup } = require("../controller/channelGroupController");
const Auth = require("../middlewares/Auth");
const { checkPermission } = require("../middlewares/checkPermission");
const { ROLES } = require("../utils/constants");
const { validateCreateChannelGroup, validateAssignChannelsToGroup, validateDeleteChannelGroup } = require("../validation/channelGroupValidation");

class ChannelGroupApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Create channel group with validation
    router.post(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateCreateChannelGroup,
      createChannelGroup
    );

    // Delete channel group
    router.delete(
      "/:groupId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateDeleteChannelGroup,
      deleteChannelGroup
    );

    // Assign channels to group with validation
    router.put(
      "/assign-channels",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      checkPermission("moveGroupsToWorkspace"),
      validateAssignChannelsToGroup,
      assignChannelsToGroup
    );

    // Get all channel groups with pagination
    router.get(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getAllChannelGroups
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/channel-groups";
  }
}

module.exports = ChannelGroupApi;