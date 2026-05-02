"use strict";

const { Router } = require("express");
const { subscribe, unsubscribe } = require("../controller/pushController");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { validateSubscribe, validateUnsubscribe } = require("../validation/pushValidation");

class PushApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    const router = this.router;

    router.post("/subscribe", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateSubscribe, subscribe);
    router.post("/unsubscribe", Auth([ROLES.ADMIN, ROLES.EMPLOYEE]), validateUnsubscribe, unsubscribe);
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/push";
  }
}

module.exports = PushApi;
