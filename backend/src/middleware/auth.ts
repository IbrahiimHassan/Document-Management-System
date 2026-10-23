import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../errors/AppError.js";
import { AUTH_COOKIE } from "../controllers/authController.js";
import * as authService from "../services/authService.js";

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE];
  if (typeof token !== "string" || token.length === 0) {
    throw new UnauthorizedError();
  }

  req.user = await authService.authenticate(token);
  next();
}