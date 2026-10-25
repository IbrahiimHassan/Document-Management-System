import { Router } from "express";
import * as documentController from "../controllers/documentController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadFile } from "../middleware/upload.js";

const router = Router();

router.post("/", requireAuth, uploadFile, documentController.createDocument);
router.get("/", requireAuth, documentController.listDocuments);

// Fixed paths come before "/:id", or Express would treat "deleted" as an id
router.get("/deleted", requireAuth, documentController.listDeleted);
router.get("/duplicates", requireAuth, documentController.findDuplicates);
router.get("/audience", requireAuth, documentController.countAudience);

router.get("/:id", requireAuth, documentController.getDocument);
router.patch("/:id", requireAuth, documentController.updateDocument);
router.delete("/:id", requireAuth, documentController.deleteDocument);
router.post("/:id/restore", requireAuth, documentController.restoreDocument);
router.get("/:id/versions", requireAuth, documentController.getVersions);
router.post("/:id/versions", requireAuth, uploadFile, documentController.addVersion);
router.get("/:id/download", requireAuth, documentController.downloadDocument);
router.get("/:id/preview", requireAuth, documentController.previewDocument);
router.get("/:id/integrity", requireAuth, documentController.checkIntegrity);
router.get("/:id/audit", requireAuth, documentController.getAuditLog);

export default router;
