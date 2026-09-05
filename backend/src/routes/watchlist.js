/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import { Router } from "express";
import { z } from "zod";
import pool from "../db/init.js";
import { requireAuth } from "../middleware/auth.js";
import { logEvent } from "../utils/audit.js";

const router = Router();
router.use(requireAuth);

const tickerSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z.]+$/, "Ticker must be letters only")
    .transform((s) => s.toUpperCase()),
});

// List of tickers the user is watching. Live price/change data is fetched
// separately by the frontend via /api/stocks/quote/:symbol — keeping this
// endpoint fast and independent of Finnhub's availability.
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT ticker, added_at FROM watchlist_items WHERE user_id = $1 ORDER BY added_at DESC",
      [req.user.id]
    );
    res.json(rows.map((r) => ({ ticker: r.ticker, addedAt: r.added_at })));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = tickerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { ticker } = parsed.data;

    const { rows } = await pool.query(
      `INSERT INTO watchlist_items (user_id, ticker) VALUES ($1, $2)
       ON CONFLICT (user_id, ticker) DO NOTHING
       RETURNING ticker, added_at`,
      [req.user.id, ticker]
    );

    if (rows.length === 0) {
      return res.status(409).json({ error: `${ticker} is already on your watchlist.` });
    }

    logEvent({ userId: req.user.id, eventType: "WATCHLIST_ADDED", req, metadata: { ticker } });
    res.status(201).json({ ticker: rows[0].ticker, addedAt: rows[0].added_at });
  } catch (err) {
    next(err);
  }
});

router.delete("/:ticker", async (req, res, next) => {
  try {
    const ticker = (req.params.ticker || "").toUpperCase();
    const result = await pool.query(
      "DELETE FROM watchlist_items WHERE user_id = $1 AND ticker = $2",
      [req.user.id, ticker]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `${ticker} is not on your watchlist.` });
    }

    logEvent({ userId: req.user.id, eventType: "WATCHLIST_REMOVED", req, metadata: { ticker } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
