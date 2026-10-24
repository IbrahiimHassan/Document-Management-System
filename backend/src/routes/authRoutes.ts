import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { loginRateLimit } from "../middleware/rateLimit.js";
import * as authController from "../controllers/authController.js";

const router = Router();

router.post("/login", loginRateLimit, authController.login);
router.post("/logout", authController.logout);
router.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ user: req.user });
});

export default router;