import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { ValidationError } from "../errors/AppError.js";
import { loginSchema } from "../schemas/authSchemas.js";
import * as authService from "../services/authService.js";

export const AUTH_COOKIE = "token";

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  const { token, user } = await authService.login(
    parsed.data.email,
    parsed.data.password,
  );

  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: authService.TOKEN_MAX_AGE_MS,
  });

  res.status(200).json({ user });
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(AUTH_COOKIE);
  res.status(204).send();
}