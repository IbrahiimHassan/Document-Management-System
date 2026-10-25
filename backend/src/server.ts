
import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./config/database.js";
import * as cache from "./cache/cache.js";
import * as virusScanner from "./files/virusScanner.js";

async function bootstrap(): Promise<void> {
  try {
    await pool.query("SELECT 1");
    console.log("Database connected successfully");

    await cache.ready();
    console.log(`Cache: ${cache.status()}`);
    console.log(`Virus scanner: ${await virusScanner.status()}`);

    const server = app.listen(env.PORT, () => {
      console.log(
        `Server running in ${env.NODE_ENV} mode on port ${env.PORT}`,
      );
    });

    let shuttingDown = false;

    async function shutdown(signal: string): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`${signal} received. Shutting down...`);

      server.close(async (error) => {
        try {
          if (error) {
            console.error("HTTP server shutdown failed:", error);
            process.exitCode = 1;
          }

          await pool.end();
          await cache.close();
        } catch (shutdownError) {
          console.error("Database pool shutdown failed:", shutdownError);
          process.exitCode = 1;
        }
      });
    }

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  } catch (error) {
    console.error("Failed to start application:", error);
    await pool.end();
    process.exitCode = 1;
  }
}

void bootstrap();
