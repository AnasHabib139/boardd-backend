"use strict";

const { Router } = require("express");
const { createChannelGroup, assignChannelsToGroup } = require("../controller/channelGroupController");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { validateCreateChannelGroup, validateAssignChannelsToGroup } = require("../validation/channelGroupValidation");

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

    // Assign channels to group with validation
    router.put(
      "/assign-channels",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateAssignChannelsToGroup,
      assignChannelsToGroup
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