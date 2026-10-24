import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, "ROUTE_NOT_FOUND", `Route ${req.method} ${req.path} not found`));
}

// express.json() throws these before any route runs (bad JSON, body too big)
function fromBodyParser(err: unknown): AppError | null {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.parse.failed") {
    return new AppError(400, "VALIDATION_ERROR", "Request body is not valid JSON");
  }
  if (type === "entity.too.large") {
    return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  return null;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  err = fromBodyParser(err) ?? err;

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  console.error("Unexpected error:", err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
}