"use strict";

const { Router } = require("express");
const { startClock, stopClock, editTimeEntry, getUserTimeEntries } = require("../controller/clockup.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const { 
  validateStartClock, 
  validateStopClock, 
  validateEditTimeEntry,
  validateTimeEntryIdParam 
} = require("../validation/clockupValidation");

class ClockupApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Start clock - Begin time tracking
    router.post(
      "/start",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateStartClock,
      startClock
    );

    // Stop clock - End time tracking and calculate total time
    router.post(
      "/stop",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateStopClock,
      stopClock
    );

    // Edit time entry - Update title, description, times
    router.put(
      "/:entryId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTimeEntryIdParam,
      validateEditTimeEntry,
      editTimeEntry
    );

    // Get user time entries - Retrieve paginated time entries for logged-in user
    router.get(
      "/entries",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getUserTimeEntries
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/clockup";
  }
}

module.exports = ClockupApi;