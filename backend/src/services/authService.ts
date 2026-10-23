import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { UnauthorizedError } from "../errors/AppError.js";
import * as userRepository from "../repositories/userRepository.js";

export const TOKEN_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "employee";
  departmentId: string;
}

export function toPublicUser(user: userRepository.UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
  };
}

export async function login(email: string, password: string) {
  const user = await userRepository.findByEmail(email);

  // Same error for "no such email" and "wrong password"
  const passwordMatches = user
    ? await bcrypt.compare(password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, {
    expiresIn: TOKEN_MAX_AGE_MS / 1000,
  });

  return { token, user: toPublicUser(user) };
}
export async function authenticate(token: string): Promise<PublicUser> {
  let userId: string;

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      throw new Error("Malformed token");
    }
    userId = payload.sub;
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    throw new UnauthorizedError("Invalid or expired token");
  }

  return toPublicUser(user);
}