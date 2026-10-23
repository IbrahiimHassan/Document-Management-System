
import express from "express";
import { pool } from "./config/database.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";

const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ok",
      service: "document-repository-api",
      database: "connected",
    });
  } catch (error) {
    console.error("Health check database query failed:", error);

    res.status(503).json({
      status: "error",
      service: "document-repository-api",
      database: "unavailable",
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
