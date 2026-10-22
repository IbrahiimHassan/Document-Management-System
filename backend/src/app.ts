
import express from "express";
import { pool } from "./config/database.js";

const app = express();

app.use(express.json());

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

export default app;
