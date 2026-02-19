"use strict";

const { Router } = require("express");
const {
  getActiveTimer,
  startClock,
  stopClock,
  editTimeEntry,
  restartTimeEntry,
  getUserTimeEntries,
  getChildrenTimeEntries,
  deleteTimeEntry,
  duplicateTimeEntry,
  getClockupReports,
  downloadClockupReports,
  downloadSingleClockupEntry,
} = require("../controller/clockup.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");
const {
  validateStartClock,
  validateStopClock,
  validateEditTimeEntry,
  validateTimeEntryIdParam,
  validateClockupReportsQuery,
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

    // Get active timer - Check if user has a running clock
    router.get(
      "/active",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getActiveTimer
    );

    // Edit time entry - Update title, description, times
    router.put(
      "/:entryId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTimeEntryIdParam,
      validateEditTimeEntry,
      editTimeEntry
    );

    // Restart time entry - Create child entry linked to parent
    router.post(
      "/:entryId/restart",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTimeEntryIdParam,
      validateStartClock, // Reuse start validation since it needs startTime
      restartTimeEntry
    );

    // Get user time entries - Retrieve paginated time entries for logged-in user
    router.get(
      "/entries",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getUserTimeEntries
    );

    // Get clockup reports - Retrieve time entries report with date range filtering
    router.get(
      "/reports",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateClockupReportsQuery,
      getClockupReports
    );

    // Download clockup reports as PDF - Generate and download professional PDF report
    router.get(
      "/reports/download",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateClockupReportsQuery,
      downloadClockupReports
    );

    // Download single entry as PDF - Generate PDF for one time entry
    router.get(
      "/reports/:entryId/download",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTimeEntryIdParam,
      downloadSingleClockupEntry
    );

    // Get children time entries - Retrieve paginated child entries for a parent time entry
    router.get(
      "/:entryId/children",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTimeEntryIdParam,
      getChildrenTimeEntries
    );

    // Duplicate time entry - Create a copy of time entry and start it
    router.post(
      "/:entryId/duplicate",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTimeEntryIdParam,
      duplicateTimeEntry
    );

    // Delete time entry - Delete time entry with all children (if parent) or single entry (if child)
    router.delete(
      "/:entryId",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateTimeEntryIdParam,
      deleteTimeEntry
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
