/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 *
 * Dev/debug utility: decrypts and prints holdings straight from
 * PostgreSQL using the same AES-256-GCM key the app uses. Useful for
 * verifying the encryption round-trips correctly, or just for peeking
 * at your own data without going through the API.
 *
 * Usage: node view-data.js
 */

import "dotenv/config";
import pool from "./src/db/init.js";
import { decryptField } from "./src/utils/encryption.js";

async function main() {
  console.log("\n=== USERS ===");
  const { rows: users } = await pool.query(
    "SELECT id, email, totp_enabled, created_at FROM users ORDER BY id"
  );
  console.table(users);

  console.log("\n=== HOLDINGS (decrypted) ===");
  const { rows: holdings } = await pool.query("SELECT * FROM holdings ORDER BY id");
  const decrypted = holdings.map((h) => ({
    id: h.id,
    user_id: h.user_id,
    ticker: h.ticker,
    shares: decryptField(h.shares_enc),
    costBasis: decryptField(h.cost_basis_enc),
    created_at: h.created_at,
  }));
  console.table(decrypted);

  console.log("\n=== AUDIT LOG (most recent 20) ===");
  const { rows: auditLog } = await pool.query(
    `SELECT id, user_id, event_type, ip_address, created_at
     FROM audit_log ORDER BY created_at DESC LIMIT 20`
  );
  console.table(auditLog);

  console.log("\n=== PASSWORD RESET TOKENS (unused, unexpired) ===");
  const { rows: resetTokens } = await pool.query(
    `SELECT id, user_id, expires_at, created_at FROM password_reset_tokens
     WHERE used = FALSE AND expires_at > now() ORDER BY created_at DESC`
  );
  console.table(resetTokens);

  await pool.end();
}

main().catch((err) => {
  console.error("Failed to read database:", err.message);
  process.exit(1);
});
