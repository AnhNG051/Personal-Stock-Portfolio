/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAuditLogForUser } from "../utils/audit.js";

const router = Router();

// A user can only ever see their own audit trail.
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const events = await getAuditLogForUser(req.user.id, { limit: 200 });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

export default router;
