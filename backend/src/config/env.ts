import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3001),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  UPLOAD_DIR: z.string().min(1).default("uploads"),

  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),

  // Secure cookies need HTTPS. Defaults to on in production; set to "false"
  // only when production runs on plain http (like the local Docker setup).
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),

  // Optional: without it the app runs with caching turned off
  REDIS_URL: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.url("REDIS_URL must be a URL like redis://localhost:6379").optional()),

  // Optional: the ClamAV daemon that scans every upload. Without it uploads
  // are not scanned (fine for development). With it, an upload is refused
  // when the scanner can't be reached.
  CLAMAV_HOST: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),

  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),

  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");

  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }

  process.exit(1);
}

export const env = result.data;
