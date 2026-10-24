import { Router } from "express";
import * as departmentController from "../controllers/departmentController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, departmentController.listDepartments);

export default router;