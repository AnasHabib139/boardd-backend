"use strict";

const { Router } = require("express");
const {
  getCompany,
  updateCompany,
} = require("../controller/company.controller");
const Auth = require("../middlewares/Auth");
const { checkPermission } = require("../middlewares/checkPermission");
const { ROLES } = require("../utils/constants");
const {
  validateCreateCompany,
  validateUpdateCompany,
  validateGetCompanyQuery,
  validateUpdateCompanyQuery,
  validateCompanyIdParam,
  validateGetCompaniesQuery,
} = require("../validation/companyValidation");

class CompanyApi {
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  setupRoutes() {
    let router = this.router;

    // Get company with query validation
    router.get(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateGetCompanyQuery,
      getCompany
    );

    // Update company with validation
    router.put(
      "/",
      Auth([ROLES.ADMIN]),
      checkPermission("editTeamNameImage"),
      validateUpdateCompanyQuery,
      validateUpdateCompany,
      updateCompany
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/companies";
  }
}

module.exports = CompanyApi;
