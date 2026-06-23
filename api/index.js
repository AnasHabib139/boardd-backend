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
const TaskCommentApi = require("./taskCommentApi");
const SubtaskApi = require("./subtaskApi");
const ActivityApi = require("./activityApi");
const ProjectApi = require("./projectAPi");
const UploadApi = require("./uploadApi");
const ClientApi = require("./clientApi");
const FormApi = require("./formApi");
const WorkProgressApi = require("./workProgressApi");
const TeamCardApi = require("./teamCardApi");
const AdminApi = require("./adminApi");
const HomeApi = require("./homeApi");
const ClockupApi = require("./clockupApi");
const InboxApi = require("./inboxApi");
const NotificationApi = require("./notificationApi");
const UserStatusApi = require("./userStatusApi");
const ChannelGroupApi = require("./channelGroupApi");
const ProjectStatusColumnApi = require("./projectStatusColumnAPI");
const ChatApi = require("./chatApi");
const WebhookApi = require("./webhookApi");
const MessagingConfigApi = require("./messagingConfigApi");
const CloudIntegrationApi = require("./cloudIntegrationApi");
const PaymentsAPI = require("../payments-service/api");
const PermissionApi = require("./permissionApi");
const SearchApi = require("./search");
const TabTaskStatusApi = require("./tabTaskStatusApi");
const TaskConnectionApi = require("./taskConnectionApi");
const PushApi = require("./pushApi");
const TrelloImportApi = require("./trelloImportApi");
const ClickUpImportApi = require("./clickupImportApi");
const AsanaImportApi = require("./asanaImportApi");
const MondayImportApi = require("./mondayImportApi");
const JiraImportApi   = require("./jiraImportApi");
const NotionImportApi = require("./notionImportApi");
const IntegrationsApi = require("./integrationsApi");
// FileServeApi is now mounted directly in server.js at /uploadFiles
// const FileServeApi = require("./fileServeApi");
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
    this.routeGroups.push(new TaskCommentApi());
    this.routeGroups.push(new SubtaskApi());
    this.routeGroups.push(new ActivityApi());
    this.routeGroups.push(new ProjectApi());
    this.routeGroups.push(new UploadApi());
    this.routeGroups.push(new ClientApi());
    this.routeGroups.push(new FormApi());
    this.routeGroups.push(new WorkProgressApi());
    this.routeGroups.push(new TeamCardApi());
    this.routeGroups.push(new AdminApi());
    this.routeGroups.push(new HomeApi());
    this.routeGroups.push(new ClockupApi());
    this.routeGroups.push(new InboxApi());
    this.routeGroups.push(new NotificationApi());
    this.routeGroups.push(new UserStatusApi());
    this.routeGroups.push(new ChannelGroupApi());
    this.routeGroups.push(new ProjectStatusColumnApi());
    this.routeGroups.push(new ChatApi());
    this.routeGroups.push(new WebhookApi());
    this.routeGroups.push(new MessagingConfigApi());
    this.routeGroups.push(new CloudIntegrationApi());
    this.routeGroups.push(new PaymentsAPI());
    this.routeGroups.push(new PermissionApi());
    this.routeGroups.push(new SearchApi());
    this.routeGroups.push(new TabTaskStatusApi());
    this.routeGroups.push(new TaskConnectionApi());
    this.routeGroups.push(new PushApi());
    this.routeGroups.push(new TrelloImportApi());
    this.routeGroups.push(new ClickUpImportApi());
    this.routeGroups.push(new AsanaImportApi());
    this.routeGroups.push(new MondayImportApi());
    this.routeGroups.push(new JiraImportApi());
    this.routeGroups.push(new NotionImportApi());
    this.routeGroups.push(new IntegrationsApi());
    // FileServeApi is now mounted directly in server.js
    // this.routeGroups.push(new FileServeApi());
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
