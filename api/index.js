"use strict";

const { Router } = require("express");

const RootApi = require("./rootApi");
const UserApi = require("./userApi");
const AuthApi = require("./authApi");
const InviteApi = require("./inviteApi");
const CompanyApi = require("./companyApi");
const ChannelApi = require("./channelApi");
const ChannelTabsApi = require("./channelTabsApi");
const TaskApi = require("./taskApi");
const SubtaskApi = require("./subtaskApi");
const ActivityApi = require("./activityApi");
const ProjectApi = require("./projectAPi");
const UploadApi = require("./uploadApi");
const ClientApi = require("./clientApi");
const FormApi = require("./formApi");
// all API routing files import here like above

class API {
  constructor(app) {
    this.app = app;
    this.router = Router();
    this.routeGroups = [];
  }

  loadRouteGroups() {
    this.routeGroups.push(new RootApi());
    this.routeGroups.push(new UserApi());
    this.routeGroups.push(new AuthApi());
    this.routeGroups.push(new InviteApi());
    this.routeGroups.push(new CompanyApi());
    this.routeGroups.push(new ChannelApi());
    this.routeGroups.push(new ChannelTabsApi());
    this.routeGroups.push(new TaskApi());
    this.routeGroups.push(new SubtaskApi());
    this.routeGroups.push(new ActivityApi());
    this.routeGroups.push(new ProjectApi());
    this.routeGroups.push(new UploadApi());
    this.routeGroups.push(new ClientApi());
    this.routeGroups.push(new FormApi());
    // all routes register here like above
  }

  setContentType(req, res, next) {
    res.set("Content-Type", "application/json");
    next();
  }

  registerGroups() {
    this.loadRouteGroups();
    this.routeGroups.forEach((rg) => {
      console.log("Route group: " + rg.getRouterGroup());
      this.app.use(
        "/api" + rg.getRouterGroup(),
        this.setContentType,
        rg.getRouter()
      );
    });
  }
}

module.exports = API;
