import { Router } from "express";
import * as documentController from "../controllers/documentController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadFile } from "../middleware/upload.js";

const router = Router();

router.post("/", requireAuth, uploadFile, documentController.createDocument);
router.post("/:id/versions", requireAuth, uploadFile, documentController.addVersion);

export default router;