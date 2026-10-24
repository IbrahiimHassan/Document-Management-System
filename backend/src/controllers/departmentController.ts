import type { Request, Response } from "express";
import * as departmentService from "../services/departmentService.js";

export async function listDepartments(_req: Request, res: Response): Promise<void> {
  const items = await departmentService.listDepartments();
  res.status(200).json({ items });
}