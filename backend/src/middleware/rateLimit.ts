import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { AppError } from "../errors/AppError.js";

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Slows down password guessing: 10 failed logins per email and IP in 15 minutes.
// Successful logins are not counted, so normal users never hit it.
// Keyed by email too, because behind the Next.js proxy many users share one IP.
export const loginRateLimit = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_FAILURES,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}:${email}`;
  },
  handler: (_req, _res, next) => {
    next(new AppError(429, "TOO_MANY_REQUESTS", "Too many failed login attempts. Try again later."));
  },
});
