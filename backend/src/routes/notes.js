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

const noteSchema = z.object({
  interestReason: z.string().max(2000).optional().default(""),
  whatILike: z.string().max(2000).optional().default(""),
  risks: z.string().max(2000).optional().default(""),
  thesis: z.string().max(2000).optional().default(""),
  personalNotes: z.string().max(2000).optional().default(""),
});

function toResponseShape(row) {
  return {
    ticker: row.ticker,
    interestReason: row.interest_reason,
    whatILike: row.what_i_like,
    risks: row.risks,
    thesis: row.thesis,
    personalNotes: row.personal_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// All notes for the user, across every ticker they've annotated.
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM investment_notes WHERE user_id = $1 ORDER BY updated_at DESC",
      [req.user.id]
    );
    res.json(rows.map(toResponseShape));
  } catch (err) {
    next(err);
  }
});

// The note for one specific ticker (used by the stock detail page).
router.get("/:ticker", async (req, res, next) => {
  try {
    const ticker = (req.params.ticker || "").toUpperCase();
    const { rows } = await pool.query(
      "SELECT * FROM investment_notes WHERE user_id = $1 AND ticker = $2",
      [req.user.id, ticker]
    );

    if (rows.length === 0) {
      // Not an error — the user just hasn't written a note for this
      // ticker yet. Return an empty shape so the frontend can render
      // a blank form without a special case.
      return res.json({
        ticker,
        interestReason: "",
        whatILike: "",
        risks: "",
        thesis: "",
        personalNotes: "",
        createdAt: null,
        updatedAt: null,
      });
    }

    res.json(toResponseShape(rows[0]));
  } catch (err) {
    next(err);
  }
});

// Create or update the note for a ticker (upsert — one note per ticker).
router.put("/:ticker", async (req, res, next) => {
  try {
    const ticker = (req.params.ticker || "").toUpperCase();
    if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
      return res.status(400).json({ error: "Invalid ticker symbol." });
    }

    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { interestReason, whatILike, risks, thesis, personalNotes } = parsed.data;

    const { rows } = await pool.query(
      `INSERT INTO investment_notes
         (user_id, ticker, interest_reason, what_i_like, risks, thesis, personal_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, ticker) DO UPDATE SET
         interest_reason = EXCLUDED.interest_reason,
         what_i_like = EXCLUDED.what_i_like,
         risks = EXCLUDED.risks,
         thesis = EXCLUDED.thesis,
         personal_notes = EXCLUDED.personal_notes,
         updated_at = now()
       RETURNING *`,
      [req.user.id, ticker, interestReason, whatILike, risks, thesis, personalNotes]
    );

    logEvent({ userId: req.user.id, eventType: "NOTE_SAVED", req, metadata: { ticker } });
    res.json(toResponseShape(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete("/:ticker", async (req, res, next) => {
  try {
    const ticker = (req.params.ticker || "").toUpperCase();
    const result = await pool.query(
      "DELETE FROM investment_notes WHERE user_id = $1 AND ticker = $2",
      [req.user.id, ticker]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `No note found for ${ticker}.` });
    }

    logEvent({ userId: req.user.id, eventType: "NOTE_DELETED", req, metadata: { ticker } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
