/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import { Router } from "express";
import { z } from "zod";
import pool from "../db/init.js";
import { requireAuth } from "../middleware/auth.js";
import { encryptField, decryptField } from "../utils/encryption.js";
import { logEvent } from "../utils/audit.js";
import { buildHoldingsWorkbook, syncUserExcelExport } from "../utils/excelExport.js";

const router = Router();
router.use(requireAuth);

const holdingSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z.]+$/, "Ticker must be letters only")
    .transform((s) => s.toUpperCase()),
  shares: z.number().positive(),
  costBasis: z.number().positive(),
});

function decryptRow(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    shares: Number(decryptField(row.shares_enc)),
    costBasis: Number(decryptField(row.cost_basis_enc)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getDecryptedHoldingsForUser(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM holdings WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows.map(decryptRow);
}

// Regenerates the on-disk .xlsx export after any write. Never blocks or
// fails the request it's called from — export sync is a convenience, not
// a critical path.
async function resyncExcelExport(req) {
  try {
    const holdings = await getDecryptedHoldingsForUser(req.user.id);
    await syncUserExcelExport(req.user.id, req.user.email, holdings);
  } catch (err) {
    console.error("[excel export] failed to sync for user", req.user.id, err.message);
  }
}

// List holdings for the authenticated user only — no cross-user access possible
// because every query below is scoped by req.user.id.
router.get("/", async (req, res, next) => {
  try {
    const holdings = await getDecryptedHoldingsForUser(req.user.id);
    res.json(holdings);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = holdingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { ticker, shares, costBasis } = parsed.data;

    const { rows } = await pool.query(
      `INSERT INTO holdings (user_id, ticker, shares_enc, cost_basis_enc)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, ticker, encryptField(shares), encryptField(costBasis)]
    );

    logEvent({
      userId: req.user.id,
      eventType: "HOLDING_CREATED",
      req,
      metadata: { ticker, holdingId: rows[0].id },
    });

    resyncExcelExport(req);
    res.status(201).json(decryptRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const holdingId = Number(req.params.id);
    const { rows: existingRows } = await pool.query(
      "SELECT * FROM holdings WHERE id = $1 AND user_id = $2",
      [holdingId, req.user.id]
    );
    if (existingRows.length === 0) return res.status(404).json({ error: "Holding not found." });

    const parsed = holdingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { ticker, shares, costBasis } = parsed.data;

    const { rows } = await pool.query(
      `UPDATE holdings SET ticker = $1, shares_enc = $2, cost_basis_enc = $3, updated_at = now()
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [ticker, encryptField(shares), encryptField(costBasis), holdingId, req.user.id]
    );

    logEvent({ userId: req.user.id, eventType: "HOLDING_UPDATED", req, metadata: { holdingId } });
    resyncExcelExport(req);
    res.json(decryptRow(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const holdingId = Number(req.params.id);
    const result = await pool.query("DELETE FROM holdings WHERE id = $1 AND user_id = $2", [
      holdingId,
      req.user.id,
    ]);

    if (result.rowCount === 0) return res.status(404).json({ error: "Holding not found." });

    logEvent({ userId: req.user.id, eventType: "HOLDING_DELETED", req, metadata: { holdingId } });
    resyncExcelExport(req);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --- Export current holdings as a downloadable .xlsx file ------------------
router.get("/export", async (req, res, next) => {
  try {
    const holdings = await getDecryptedHoldingsForUser(req.user.id);
    const workbook = await buildHoldingsWorkbook(holdings, req.user.email);

    logEvent({ userId: req.user.id, eventType: "HOLDINGS_EXPORTED", req });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=personal-stock-portfolio.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

export default router;
