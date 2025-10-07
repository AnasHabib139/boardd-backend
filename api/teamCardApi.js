"use strict";

const { Router } = require("express");
const {
  createTeamCard,
  addMemberToCard,
  removeMemberFromCard,
  editMemberInCard,
  getTeamCards,
  getMemberProfile,
  editTeamCard,
} = require("../controller/teamCard.controller");
const Auth = require("../middlewares/Auth");
const OptionalAuth = require("../middlewares/OptionalAuth");
const { ROLES } = require("../utils/constants");
const {
  validateCreateTeamCard,
  validateAddTeamCardMember,
  validateRemoveTeamCardMember,
  validateEditTeamCardMember,
  validateTeamCardMemberIdParams,
  validateTeamCardIdParam,
  validateMemberProfile,
  validateEditTeamCard,
} = require("../validation/teamCardValidation");

class TeamCardApi {
  constructor() {
    this.router = Router();
    this.registerRoutes();
  }

  registerRoutes() {
    let router = this.router;

    // Create a new team card (admin only)
    router.post(
      "/",
      Auth([ROLES.ADMIN]),
      validateCreateTeamCard,
      createTeamCard
    );

    // Get all team cards for company (authenticated users)
    router.get(
      "/",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      getTeamCards
    );

    // Edit team card (admin only)
    router.put(
      "/:cardId",
      Auth([ROLES.ADMIN]),
      validateTeamCardIdParam,
      validateEditTeamCard,
      editTeamCard
    );

    // Add member to team card (admin only)
    router.post(
      "/:cardId/members",
      Auth([ROLES.ADMIN]),
      validateTeamCardIdParam,
      validateAddTeamCardMember,
      addMemberToCard
    );

    // Edit member in team card (admin only)
    router.put(
      "/:cardId/members/:memberId",
      Auth([ROLES.ADMIN]),
      validateTeamCardMemberIdParams,
      validateEditTeamCardMember,
      editMemberInCard
    );

    // Remove member from team card (admin only)
    router.delete(
      "/:cardId/members",
      Auth([ROLES.ADMIN]),
      validateTeamCardIdParam,
      validateRemoveTeamCardMember,
      removeMemberFromCard
    );

    // Get member profile with tasks (authenticated users)
    router.get(
      "/members/:memberId/profile",
      Auth([ROLES.ADMIN, ROLES.EMPLOYEE]),
      validateMemberProfile,
      getMemberProfile
    );
  }

  getRouter() {
    return this.router;
  }

  getRouterGroup() {
    return "/team-cards";
  }
}

module.exports = TeamCardApi;