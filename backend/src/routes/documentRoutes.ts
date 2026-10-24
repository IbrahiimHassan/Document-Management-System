import { Router } from "express";
import * as documentController from "../controllers/documentController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadFile } from "../middleware/upload.js";

const router = Router();

router.post("/", requireAuth, uploadFile, documentController.createDocument);
router.get("/", requireAuth, documentController.listDocuments);
router.get("/:id", requireAuth, documentController.getDocument);
router.get("/:id/versions", requireAuth, documentController.getVersions);
router.get("/:id/download", requireAuth, documentController.downloadDocument);
router.get("/:id/audit", requireAuth, documentController.getAuditLog);
router.post("/:id/versions", requireAuth, uploadFile, documentController.addVersion);

export default router;