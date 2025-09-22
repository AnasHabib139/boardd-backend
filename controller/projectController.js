const { findChannel } = require("../models/channelModel");
const { findChannelTab } = require("../models/channelTabsModel");
const { createProject, getAllProjects, getAllProjectsWithoutPagination, findProject, updateProject, deleteProject } = require("../models/projectModel");
const { findUser } = require("../models/userModel");
const { findCompany } = require("../models/companyModel");
const { parseBody, generateResponse, formatDate } = require("../utils");
const { STATUS_CODES } = require("../utils/constants");
const { emitTaskEvent } = require("../utils/socket");
const {
  getProjectsOverviewQuery,
  getProjectsListQuery,
  getProjectBoardQuery,
  getTasksCalendarQuery,
  getOpenTasksQuery,
} = require("./queries/projectQueries");

// Helper function to parse date strings
const parseDate = (dateString) => {
  if (!dateString) return undefined;

  // If it's already a Date object, return it
  if (dateString instanceof Date) return dateString;

  // Handle DD-MM-YYYY format
  if (
    typeof dateString === "string" &&
    dateString.match(/^\d{2}-\d{2}-\d{4}$/)
  ) {
    const [day, month, year] = dateString.split("-");
    return new Date(year, month - 1, day); // month is 0-indexed
  }

  // Handle other formats (YYYY-MM-DD, ISO, etc.)
  return new Date(dateString);
};

exports.CreateProject = async (req, res, next) => {
  try {
    const { name, description, tabId, startDate, endDate, color, priority } =
      parseBody(req.body);
    const userId = req?.user?.id;

    // check if tabId is valid
    const tab = await findChannelTab({ _id: tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found",
      });
    }
    const companyId = tab?.companyId;
    const channelId = tab?.channelId;

    // Get user and channel information for socket context
    const [user, channel] = await Promise.all([
      findUser({ _id: userId }),
      findChannel({ _id: channelId }),
    ]);

    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // create project
    const project = await createProject({
      name,
      description,
      createdBy: userId,
      companyId,
      channelId,
      tabId,
      startDate: parseDate(startDate),
      endDate: parseDate(endDate),
      color,
      priority,
    });

    // Emit project creation notification (no activity tracking for projects)
    const userName = user.name || user.email;
    const contextPath = `${channel.channelName} / ${tab.tabName}`;

    emitTaskEvent({
      channelId: channel._id,
      type: "PROJECT_CREATED",
      payload: {
        project: {
          _id: project._id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          color: project.color,
          priority: project.priority,
          createdBy: project.createdBy,
          createdAt: project.createdAt,
        },
        updatedBy: {
          _id: user._id,
          name: user.name,
          email: user.email,
        },
        context: {
          channelId: channel._id,
          channelName: channel.channelName,
          tabId: tab._id,
          tabName: tab.tabName,
          contextPath: contextPath,
        },
      },
    });

    return generateResponse(
      project,
      "Project created successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

// Get projects of a tab with conditional view (overview, list, or calendar)
// List view provides ordered tasks for frontend board display
exports.getProjectsOfTab = async (req, res, next) => {
  try {
    const { channelId, tabId } = req.params;
    const { page, limit, view, currentDate } = req.query;
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Fetch company details for context
    const company = await findCompany({
      _id: channel.companyId,
    });

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Validate tab exists and belongs to the channel
    const tab = await findChannelTab({ _id: tabId, channelId: channelId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found in this channel",
      });
    }

    // Check if user is a member of the tab (if tab has specific members)
    if (
      tab.members &&
      tab.members.length > 0 &&
      !tab.members.includes(userId)
    ) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Handle calendar view separately
    if (view === "calendar") {
      return handleCalendarView(req, res, next, {
        channelId,
        tabId,
        userId,
        currentDate: new Date(currentDate),
        channel,
        tab,
        user,
      });
    }

    // Choose query based on view parameter
    let query;
    let responseKey = "projects";

    if (view === "overview") {
      query = getProjectsOverviewQuery(channelId, tabId);
      responseKey = "projects"; // Same key but different data structure
    } else {
      // Default to detailed list view
      query = getProjectsListQuery(channelId, tabId);
    }

    // Fetch projects with pagination
    const result = await getAllProjects({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "projects",
      sort: { isPinned: -1, createdAt: -1 }, // Pinned first, then newest
    });

    // For list view, also fetch open tasks (tasks without project)
    let openTasks = [];
    if (view !== "overview") {
      const { getAllTasks } = require("../models/taskModel");
      const openTasksQuery = getOpenTasksQuery(channelId);
      
      try {
        const openTasksResult = await getAllTasks({
          query: openTasksQuery,
          page: 1,
          limit: 1000, // Get all open tasks
          responseKey: "openTasks",
        });
        openTasks = openTasksResult.openTasks || [];
      } catch (error) {
        console.error("Error fetching open tasks:", error);
        openTasks = [];
      }
    }

    // Sort tasks by orderIndex within each status category (with fallbacks for missing orderIndex)
    if (result.projects) {
      result.projects = result.projects.map((project) => {
        // Helper function to sort tasks with orderIndex fallback
        const sortTasksByOrderIndex = (tasks, status) => {
          return tasks.sort((a, b) => {
            const aOrder =
              a.orderIndex?.[status] || new Date(a.createdAt).getTime();
            const bOrder =
              b.orderIndex?.[status] || new Date(b.createdAt).getTime();
            return aOrder - bOrder;
          });
        };

        return {
          ...project,
          todoTasks: sortTasksByOrderIndex(project.todoTasks || [], "todo"),
          inProgressTasks: sortTasksByOrderIndex(
            project.inProgressTasks || [],
            "in_progress"
          ),
          completedTasks: sortTasksByOrderIndex(
            project.completedTasks || [],
            "completed"
          ),
        };
      });
    }

    // Prepare response data based on view
    let responseData;

    if (view === "overview") {
      // Overview response - minimal data
      responseData = {
        ...result,
        view: "overview",
        context: {
          channel: {
            id: channel._id,
            name: channel.channelName,
          },
          tab: {
            id: tab._id,
            name: tab.tabName,
          },
          company: {
            id: channel.companyId,
            name: company?.name || "Unknown Company",
          },
        },
        summary: {
          totalProjects: result.pagination.totalDocs,
          projectsWithTasks: result.projects.filter((p) => p.taskCount > 0)
            .length,
          totalTasks: result.projects.reduce((sum, p) => sum + p.taskCount, 0),
          averageProgress:
            result.projects.length > 0
              ? Math.round(
                  (result.projects.reduce((sum, p) => sum + p.progress, 0) /
                    result.projects.length) *
                    10
                ) / 10
              : 0,
        },
      };
    } else {
      // Process open tasks by status for better organization
      const processOpenTasks = (tasks) => {
        const sortTasksByOrderIndex = (tasks, status) => {
          return tasks.sort((a, b) => {
            const aOrder = a.orderIndex?.[status] || new Date(a.createdAt).getTime();
            const bOrder = b.orderIndex?.[status] || new Date(b.createdAt).getTime();
            return aOrder - bOrder;
          });
        };

        const todoTasks = sortTasksByOrderIndex(
          tasks.filter(t => t.status === "todo"),
          "todo"
        );
        const inProgressTasks = sortTasksByOrderIndex(
          tasks.filter(t => t.status === "in_progress"),
          "in_progress"
        );
        const completedTasks = sortTasksByOrderIndex(
          tasks.filter(t => t.status === "completed"),
          "completed"
        );

        return {
          todoTasks,
          inProgressTasks,
          completedTasks,
          taskStats: {
            total: tasks.length,
            todo: todoTasks.length,
            inProgress: inProgressTasks.length,
            completed: completedTasks.length,
            overdue: tasks.filter(t => t.isOverdue).length,
          },
          progress: tasks.length > 0 
            ? Math.round((completedTasks.length / tasks.length) * 100 * 10) / 10
            : 0,
        };
      };

      // Create Open category if there are open tasks
      let openProject = null;
      if (openTasks.length > 0) {
        const processedOpenTasks = processOpenTasks(openTasks);
        openProject = {
          _id: "open",
          name: "Open",
          description: "Tasks without specific project",
          status: "active",
          startDate: null,
          endDate: null,
          priority: "medium",
          color: "#808080",
          createdAt: new Date(),
          updatedAt: new Date(),
          creator: null,
          channel: {
            _id: channel._id,
            channelName: channel.channelName,
          },
          tab: null,
          todoTasks: processedOpenTasks.todoTasks,
          inProgressTasks: processedOpenTasks.inProgressTasks,
          completedTasks: processedOpenTasks.completedTasks,
          taskStats: processedOpenTasks.taskStats,
          progress: processedOpenTasks.progress,
          contextPath: `${channel.channelName} / Open`,
          isOverdue: false,
          daysUntilDue: null,
        };
      }

      // Include open project in the projects list
      const allProjects = openProject 
        ? [openProject, ...result.projects]
        : result.projects;

      // Calculate totals including open tasks
      const totalOpenTasks = openTasks.length;
      const completedOpenTasks = openTasks.filter(t => t.status === "completed").length;
      const overdueOpenTasks = openTasks.filter(t => t.isOverdue).length;

      // Detailed list response - full data with tasks
      responseData = {
        ...result,
        projects: allProjects,
        view: "list",
        context: {
          channel: {
            id: channel._id,
            name: channel.channelName,
          },
          tab: {
            id: tab._id,
            name: tab.tabName,
          },
          company: {
            id: channel.companyId,
            name: company?.name || "Unknown Company",
          },
        },
        summary: {
          totalProjects: result.pagination.totalDocs + (openProject ? 1 : 0),
          projectsWithTasks: result.projects.filter(
            (p) => p.taskStats.total > 0
          ).length + (openProject && openProject.taskStats.total > 0 ? 1 : 0),
          totalTasks: result.projects.reduce(
            (sum, p) => sum + p.taskStats.total,
            0
          ) + totalOpenTasks,
          completedTasks: result.projects.reduce(
            (sum, p) => sum + p.taskStats.completed,
            0
          ) + completedOpenTasks,
          overdueTasks: result.projects.reduce(
            (sum, p) => sum + p.taskStats.overdue,
            0
          ) + overdueOpenTasks,
        },
      };
    }

    const message =
      view === "overview"
        ? "Projects overview fetched successfully"
        : "Projects with tasks fetched successfully";

    return generateResponse(responseData, message, res, STATUS_CODES.SUCCESS);
  } catch (error) {
    console.error("Error in getProjectsOfTab:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch projects",
    });
  }
};

/**
 * Get projects overview of a tab
 * Returns minimal project data with search functionality
 */
exports.getProjectsOverview = async (req, res, next) => {
  try {
    const { channelId, tabId } = req.params;
    const { page, limit, search } = req.query;
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Validate tab exists and belongs to the channel
    const tab = await findChannelTab({ _id: tabId, channelId: channelId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found in this channel",
      });
    }

    // Check if user is a member of the tab (if tab has specific members)
    if (
      tab.members &&
      tab.members.length > 0 &&
      !tab.members.includes(userId)
    ) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Get overview query with search
    const query = getProjectsOverviewQuery(channelId, tabId, search);

    // Determine sorting based on search
    let sortOptions;
    if (search) {
      // Sort by search relevance (searchScore desc, then createdAt desc)
      sortOptions = { searchScore: -1, createdAt: -1 };
    } else {
      // Default sorting (createdAt desc)
      sortOptions = { createdAt: -1 };
    }

    // Fetch projects with pagination and sorting
    const result = await getAllProjects({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "projects",
      sort: sortOptions,
    });

    return generateResponse(
      {
        ...result,
        view: "overview",
        search: search || null,
        context: {
          channel: {
            id: channel._id,
            name: channel.channelName,
          },
          tab: {
            id: tab._id,
            name: tab.tabName,
          },
        },
      },
      "Projects overview fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getProjectsOverview:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get projects list of a tab with detailed task information
 * Returns full project data with tasks and includes open tasks when not searching
 */
exports.getProjectsList = async (req, res, next) => {
  try {
    const { channelId, tabId } = req.params;
    const { page, limit, search } = req.query;
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Validate tab exists and belongs to the channel
    const tab = await findChannelTab({ _id: tabId, channelId: channelId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found in this channel",
      });
    }

    // Check if user is a member of the tab (if tab has specific members)
    if (
      tab.members &&
      tab.members.length > 0 &&
      !tab.members.includes(userId)
    ) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Get list query with search
    const query = getProjectsListQuery(channelId, tabId, search);

    // Determine sorting based on search
    let sortOptions;
    if (search && search.trim()) {
      // Sort by search relevance (pinned first, then searchScore desc, then createdAt desc)
      sortOptions = { isPinned: -1, searchScore: -1, createdAt: -1 };
    } else {
      // Default sorting (pinned first, then createdAt desc)
      sortOptions = { isPinned: -1, createdAt: -1 };
    }

    // Fetch projects with pagination and sorting
    const result = await getAllProjects({
      query,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      responseKey: "projects",
      sort: sortOptions,
    });

    // Sort tasks by orderIndex within each status category for each project
    if (result.projects) {
      result.projects = result.projects.map((project) => {
        // Helper function to sort tasks with orderIndex fallback
        const sortTasksByOrderIndex = (tasks, status) => {
          return tasks.sort((a, b) => {
            const aOrder =
              a.orderIndex?.[status] || new Date(a.createdAt).getTime();
            const bOrder =
              b.orderIndex?.[status] || new Date(b.createdAt).getTime();
            return aOrder - bOrder;
          });
        };

        return {
          ...project,
          todoTasks: sortTasksByOrderIndex(project.todoTasks || [], "todo"),
          inProgressTasks: sortTasksByOrderIndex(
            project.inProgressTasks || [],
            "in_progress"
          ),
          completedTasks: sortTasksByOrderIndex(
            project.completedTasks || [],
            "completed"
          ),
        };
      });
    }

    // Only fetch and include open tasks if not searching
    let openProject = null;
    if (!search || !search.trim()) {
      const { getAllTasks } = require("../models/taskModel");
      const openTasksQuery = getOpenTasksQuery(channelId);
      
      try {
        const openTasksResult = await getAllTasks({
          query: openTasksQuery,
          page: 1,
          limit: 1000, // Get all open tasks
          responseKey: "openTasks",
        });
        
        const openTasks = openTasksResult.openTasks || [];

        if (openTasks.length > 0) {
          // Process open tasks by status for better organization
          const processOpenTasks = (tasks) => {
            const sortTasksByOrderIndex = (tasks, status) => {
              return tasks.sort((a, b) => {
                const aOrder = a.orderIndex?.[status] || new Date(a.createdAt).getTime();
                const bOrder = b.orderIndex?.[status] || new Date(b.createdAt).getTime();
                return aOrder - bOrder;
              });
            };

            const todoTasks = sortTasksByOrderIndex(
              tasks.filter(t => t.status === "todo"),
              "todo"
            );
            const inProgressTasks = sortTasksByOrderIndex(
              tasks.filter(t => t.status === "in_progress"),
              "in_progress"
            );
            const completedTasks = sortTasksByOrderIndex(
              tasks.filter(t => t.status === "completed"),
              "completed"
            );

            return {
              todoTasks,
              inProgressTasks,
              completedTasks,
              taskStats: {
                total: tasks.length,
                todo: todoTasks.length,
                inProgress: inProgressTasks.length,
                completed: completedTasks.length,
                overdue: tasks.filter(t => t.isOverdue).length,
              },
              progress: tasks.length > 0 
                ? Math.round((completedTasks.length / tasks.length) * 100 * 10) / 10
                : 0,
            };
          };

          const processedOpenTasks = processOpenTasks(openTasks);
          openProject = {
            _id: "open",
            name: "Open",
            description: "Tasks without specific project",
            status: "active",
            startDate: null,
            endDate: null,
            priority: "medium",
            color: "#808080",
            isPinned: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            creator: null,
            channel: {
              _id: channel._id,
              channelName: channel.channelName,
            },
            tab: {
              _id: tab._id,
              tabName: tab.tabName,
            },
            todoTasks: processedOpenTasks.todoTasks,
            inProgressTasks: processedOpenTasks.inProgressTasks,
            completedTasks: processedOpenTasks.completedTasks,
            taskStats: processedOpenTasks.taskStats,
            progress: processedOpenTasks.progress,
            fileAttached: openTasks.reduce((sum, task) => sum + (task.fileCount || 0), 0),
            linksAttached: openTasks.reduce((sum, task) => sum + (task.linkCount || 0), 0),
            contextPath: `${channel.channelName} / ${tab.tabName}`,
            isOverdue: false,
            daysUntilDue: null,
          };
        }
      } catch (error) {
        console.error("Error fetching open tasks:", error);
      }
    }

    // Include open project in the projects list if it exists
    const allProjects = openProject 
      ? [openProject, ...result.projects]
      : result.projects;

    return generateResponse(
      {
        ...result,
        projects: allProjects,
        view: "list",
        search: search || null,
        context: {
          channel: {
            id: channel._id,
            name: channel.channelName,
          },
          tab: {
            id: tab._id,
            name: tab.tabName,
          },
        },
      },
      "Projects list fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getProjectsList:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get tasks for calendar view of a tab
 * Returns tasks for the current month with optional search on task title
 */
exports.getProjectsCalendar = async (req, res, next) => {
  try {
    const { channelId, tabId } = req.params;
    const { currentDate, search } = req.query;
    const userId = req.user.id;

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Validate channel exists and user has access
    const channel = await findChannel({ _id: channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Validate tab exists and belongs to the channel
    const tab = await findChannelTab({ _id: tabId, channelId: channelId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Tab not found in this channel",
      });
    }

    // Check if user is a member of the tab (if tab has specific members)
    if (
      tab.members &&
      tab.members.length > 0 &&
      !tab.members.includes(userId)
    ) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Parse and validate the current date
    let parsedCurrentDate;
    if (currentDate) {
      parsedCurrentDate = new Date(currentDate);
      if (isNaN(parsedCurrentDate.getTime())) {
        return next({
          statusCode: STATUS_CODES.BAD_REQUEST,
          message: "Invalid date format provided",
        });
      }
    } else {
      // Default to current date if not provided
      parsedCurrentDate = new Date();
    }

    // Get calendar query for tasks with search
    const query = getTasksCalendarQuery(channelId, tabId, userId, parsedCurrentDate, search);

    // Execute query without pagination to get all tasks for the month
    const tasks = await getAllProjectsWithoutPagination(query);

    // Calculate month boundaries for context
    const year = parsedCurrentDate.getFullYear();
    const month = parsedCurrentDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // Prepare calendar response
    const responseData = {
      tasks: tasks || [],
      view: "calendar",
      search: search || null,
      totalTasks: tasks ? tasks.length : 0,
      monthInfo: {
        currentDate: parsedCurrentDate.toISOString().split("T")[0],
        month: month + 1, // 1-based month
        year,
        monthStart: monthStart.toISOString().split("T")[0],
        monthEnd: monthEnd.toISOString().split("T")[0],
        monthName: monthStart.toLocaleDateString("en-US", { month: "long" }),
      },
      context: {
        channel: {
          id: channel._id,
          name: channel.channelName,
        },
        tab: {
          id: tab._id,
          name: tab.tabName,
        },
      },
    };

    const message = search 
      ? `Calendar tasks for ${monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })} matching "${search}" fetched successfully`
      : `Calendar tasks for ${monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })} fetched successfully`;

    return generateResponse(
      responseData,
      message,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getProjectsCalendar:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch calendar data",
    });
  }
};

/**
 * Get project board view with tasks organized by status
 * Returns project data with tasks separated into todo, in_progress, and completed
 */
exports.getProjectBoard = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    // Validate project ID format
    if (!projectId || projectId.length !== 24) {
      return next({
        statusCode: STATUS_CODES.BAD_REQUEST,
        message: "Invalid project ID format",
      });
    }

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Get board query for the specific project
    const query = getProjectBoardQuery(projectId);

    // Execute query to get project with tasks
    const result = await getAllProjectsWithoutPagination(query);

    // Check if project exists
    if (!result || result.length === 0) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    const project = result[0];

    // Find the actual project to get channelId and tabId for validation
    const fullProject = await findProject({ _id: projectId });
    if (!fullProject) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Validate user has access to this project (via channel membership)
    const channel = await findChannel({ _id: fullProject.channelId });
    if (!channel) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Channel not found",
      });
    }

    // Check if user is a member of the channel
    if (!channel.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this channel",
      });
    }

    // Validate tab access if tab has specific members
    const tab = await findChannelTab({ _id: fullProject.tabId });
    if (tab && tab.members && tab.members.length > 0 && !tab.members.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You are not a member of this tab",
      });
    }

    // Sort tasks by orderIndex within each status category
    const sortTasksByOrderIndex = (tasks, status) => {
      return tasks.sort((a, b) => {
        const aOrder =
          a.orderIndex?.[status] || new Date(a.createdAt).getTime();
        const bOrder =
          b.orderIndex?.[status] || new Date(b.createdAt).getTime();
        return aOrder - bOrder;
      });
    };

    // Organize and sort tasks
    const organizedProject = {
      ...project,
      todoTasks: sortTasksByOrderIndex(project.todoTasks || [], "todo"),
      inProgressTasks: sortTasksByOrderIndex(
        project.inProgressTasks || [],
        "in_progress"
      ),
      completedTasks: sortTasksByOrderIndex(
        project.completedTasks || [],
        "completed"
      ),
    };

    // Prepare response data
    const responseData = {
      project: organizedProject,
      view: "board",
      context: {
        channel: {
          id: channel._id,
          name: channel.channelName,
        },
      },
    };

    return generateResponse(
      responseData,
      "Project board fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getProjectBoard:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch project board",
    });
  }
};

// Helper function to handle calendar view
const handleCalendarView = async (req, res, next, params) => {
  try {
    const { channelId, tabId, userId, currentDate, channel, tab, user } =
      params;

    // Get calendar query for tasks
    const query = getTasksCalendarQuery(channelId, tabId, userId, currentDate);

    // Execute query without pagination to get all tasks for the month
    const tasks = await ProjectModel.getAllProjectsWithoutPagination(query);

    // Calculate month boundaries for context
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // Prepare lightweight calendar response without context
    const responseData = {
      tasks: tasks || [],
      view: "calendar",
      totalTasks: tasks ? tasks.length : 0,
      monthInfo: {
        currentDate: currentDate.toISOString().split("T")[0],
        month: month + 1, // 1-based month
        year,
        monthStart: monthStart.toISOString().split("T")[0],
        monthEnd: monthEnd.toISOString().split("T")[0],
        monthName: monthStart.toLocaleDateString("en-US", { month: "long" }),
      },
    };

    return generateResponse(
      responseData,
      `Calendar tasks for ${monthStart.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })} fetched successfully`,
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in handleCalendarView:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message ?? "Failed to fetch calendar data",
    });
  }
};

/**
 * Toggle project status (active/archived)
 */
exports.toggleProjectStatus = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const userId = req?.user?.id;

    // Find project
    const project = await findProject({ _id: projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user has access to the project (via tab membership)
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project tab not found",
      });
    }

    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this project",
      });
    }

    // Toggle status: active <-> archived
    const newStatus = project.status === "active" ? "archived" : "active";
    const updatedProject = await updateProject(
      { _id: projectId },
      { 
        status: newStatus,
        updatedAt: new Date()
      }
    );

    return generateResponse(
      { 
        projectId, 
        status: updatedProject.status,
        message: `Project ${newStatus}`
      },
      "Project status updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in toggleProjectStatus:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Toggle project pin status
 */
exports.toggleProjectPin = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const userId = req?.user?.id;

    // Find project
    const project = await findProject({ _id: projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user has access to the project (via tab membership)
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project tab not found",
      });
    }

    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this project",
      });
    }

    // Toggle pin status
    const updatedProject = await updateProject(
      { _id: projectId },
      { 
        isPinned: !project.isPinned,
        updatedAt: new Date()
      }
    );

    return generateResponse(
      { 
        projectId, 
        isPinned: updatedProject.isPinned,
        message: updatedProject.isPinned ? "Project pinned" : "Project unpinned"
      },
      "Project pin status updated successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in toggleProjectPin:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Delete project
 */
exports.deleteProjectById = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const userId = req?.user?.id;

    // Find project
    const project = await findProject({ _id: projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user has access to the project (via tab membership)
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project tab not found",
      });
    }

    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this project",
      });
    }

    // Delete the project
    await deleteProject({ _id: projectId });

    return generateResponse(
      { 
        projectId,
        message: "Project deleted successfully"
      },
      "Project deleted successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in deleteProjectById:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Get project by ID
 */
exports.getProjectById = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const userId = req?.user?.id;

    // Find project
    const project = await findProject({ _id: projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user has access to the project (via tab membership)
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project tab not found",
      });
    }

    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this project",
      });
    }

    return generateResponse(
      project,
      "Project fetched successfully",
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in getProjectById:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};

/**
 * Update project details
 */
exports.updateProjectById = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const userId = req?.user?.id;
    const { name, description, startDate, endDate, color, priority } = parseBody(req.body);

    // Find project
    const project = await findProject({ _id: projectId });
    if (!project) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project not found",
      });
    }

    // Validate user exists
    const user = await findUser({ _id: userId });
    if (!user) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "User not found",
      });
    }

    // Check if user has access to the project (via tab membership)
    const tab = await findChannelTab({ _id: project.tabId });
    if (!tab) {
      return next({
        statusCode: STATUS_CODES.NOT_FOUND,
        message: "Project tab not found",
      });
    }

    if (!tab?.members?.includes(userId)) {
      return next({
        statusCode: STATUS_CODES.FORBIDDEN,
        message: "You don't have access to this project",
      });
    }

    // Prepare update data (only include fields that are provided)
    const updateData = {
      updatedAt: new Date()
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (startDate !== undefined) updateData.startDate = parseDate(startDate);
    if (endDate !== undefined) updateData.endDate = parseDate(endDate);
    if (color !== undefined) updateData.color = color;
    if (priority !== undefined) updateData.priority = priority;

    // Update the project
    const updatedProject = await updateProject({ _id: projectId }, updateData);

    return generateResponse(
      updatedProject,
      "Project updated successfully", 
      res,
      STATUS_CODES.SUCCESS
    );
  } catch (error) {
    console.error("Error in updateProjectById:", error);
    return next({
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      message: error?.message,
    });
  }
};
