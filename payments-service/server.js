"use strict";

const express = require("express");
const PaymentsAPI = require("./api");
const config = require("./config");

/**
 * Payments Service Express Application
 * Can run as standalone microservice or be mounted on main app
 */
function createPaymentsApp() {
  const app = express();

  // Middleware (only if running standalone)
  if (config.service.mode === "standalone") {
    const cors = require("cors");
    const morgan = require("morgan");

    // CORS for standalone mode
    app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
      credentials: true,
    }));

    // Logging
    app.use(morgan("combined"));

    // Body parsing (except for webhooks)
    app.use((req, res, next) => {
      if (req.originalUrl === "/webhooks/stripe") {
        next(); // Skip body parsing for webhooks
      } else {
        express.json({ limit: "10mb" })(req, res, next);
      }
    });

    app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  }

  // Mount API routes
  const paymentsApi = new PaymentsAPI();
  app.use(paymentsApi.getRouterGroup(), paymentsApi.getRouter());

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      service: "payments",
      mode: config.service.mode,
      timestamp: new Date().toISOString(),
    });
  });

  // Error handling
  app.use((err, req, res, next) => {
    console.error("Payments service error:", err);

    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal server error";

    res.status(statusCode).json({
      error: true,
      message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
  });

  return app;
}

// If running standalone, start the server
if (config.service.mode === "standalone") {
  const app = createPaymentsApp();
  const PORT = config.service.port;

  // Connect to database
  const mongoose = require("mongoose");
  mongoose
    .connect(config.database.url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => {
      console.log("Payments service connected to MongoDB");

      // Start server
      app.listen(PORT, () => {
        console.log(`Payments service running on port ${PORT}`);
        console.log(`Mode: ${config.service.mode}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
      });
    })
    .catch((error) => {
      console.error("Failed to connect to MongoDB:", error);
      process.exit(1);
    });
}

// Export for embedding in main app
module.exports = createPaymentsApp();
