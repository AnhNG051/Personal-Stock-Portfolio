/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import pg from "pg";

const { Pool } = pg;

// Connect using a single DATABASE_URL (recommended), or discrete
// PG* env vars if that's not set. Both are standard `pg` behavior.
export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "personal_stock_portfolio",
    });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Single-use, short-lived tokens for the forgot-password flow.
  -- Only a hash of the token is stored, same pattern as refresh_tokens,
  -- so a database read alone can't be replayed as a valid reset link.
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Sensitive columns (shares, cost_basis_enc) are stored AES-256-GCM encrypted.
  -- ticker is considered non-sensitive metadata and stored plain for query simplicity.
  CREATE TABLE IF NOT EXISTS holdings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    shares_enc TEXT NOT NULL,
    cost_basis_enc TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Stocks a user is following but doesn't necessarily own. One row per
  -- (user, ticker) pair — a user can't watch the same ticker twice.
  CREATE TABLE IF NOT EXISTS watchlist_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, ticker)
  );

  -- Freeform research notes per stock. One row per (user, ticker) — adding
  -- a note for a ticker you've already annotated updates it in place.
  CREATE TABLE IF NOT EXISTS investment_notes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    interest_reason TEXT NOT NULL DEFAULT '',
    what_i_like TEXT NOT NULL DEFAULT '',
    risks TEXT NOT NULL DEFAULT '',
    thesis TEXT NOT NULL DEFAULT '',
    personal_notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, ticker)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);
  CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist_items(user_id);
  CREATE INDEX IF NOT EXISTS idx_notes_user ON investment_notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);
`;

export async function initSchema() {
  await pool.query(SCHEMA);
}

export default pool;
