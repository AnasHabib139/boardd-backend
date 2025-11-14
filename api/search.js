"use strict";

const { Router } = require("express");
const { validateGlobalSearch } = require("../validation/searchValidation");
const { globalSearch, getDesignations } = require("../controller/search.controller");
const Auth = require("../middlewares/Auth");
const { ROLES } = require("../utils/constants");

class SearchApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    /**
     * @route   GET /api/search
     * @desc    Global search across tasks, members, chats, files, documents, templates
     * @access  Private
     * @query   q - Search query string (optional)
     * @query   types - Comma-separated entity types or "all" (default: "all")
     * @query   assignedTo - Filter by assigned user ID
     * @query   createdBy - Filter by creator user ID
     * @query   status - Filter by task status (todo, in_progress, completed)
     * @query   startDate - Filter by start date (ISO format)
     * @query   endDate - Filter by end date (ISO format)
     * @query   designation - Filter by user designation
     * @query   sortBy - Sort by latest, name, or relevance (default: latest)
     * @query   page - Page number (default: 1)
     * @query   limit - Results per page (default: 10, max: 100)
     */
    router.get(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGlobalSearch,
      globalSearch
    );

    /**
     * @route   GET /api/search/designations
     * @desc    Get unique designations for company (for dropdown filters)
     * @access  Private
     */
    router.get(
      "/designations",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getDesignations
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/search";
  }
}

module.exports = SearchApi;
