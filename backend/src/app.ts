
import express from "express";
import helmet from "helmet";
import { pool } from "./config/database.js";
import * as cache from "./cache/cache.js";
import * as virusScanner from "./files/virusScanner.js";
import docsRoutes from "./docs/docsRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import departmentRoutes from "./routes/departmentRoutes.js";

const app = express();

// Don't advertise "Express" in every response
app.disable("x-powered-by");
// Security headers (nosniff, frame-ancestors, HSTS, ...)
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  const scanner = await virusScanner.status();
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ok",
      service: "document-repository-api",
      database: "connected",
      // Informational only: the API works without the cache
      cache: cache.status(),
      // When enabled but unavailable, uploads are refused until it is back
      virusScanner: scanner,
    });
  } catch (error) {
    console.error("Health check database query failed:", error);

    res.status(503).json({
      status: "error",
      service: "document-repository-api",
      database: "unavailable",
      cache: cache.status(),
      virusScanner: scanner,
    });
  }
});

app.use("/api/docs", docsRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/departments", departmentRoutes);
app.use(notFoundHandler);
app.use(errorHandler);
export default app;
