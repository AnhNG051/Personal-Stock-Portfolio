/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import pool from "../db/init.js";

/**
 * Records a security-relevant event. Never throws — logging must not
 * break the request it's observing.
 *
 * @param {object} params
 * @param {number|null} params.userId
 * @param {string} params.eventType e.g. "LOGIN_SUCCESS", "LOGIN_FAILED", "HOLDING_CREATED"
 * @param {import('express').Request} params.req
 * @param {object} [params.metadata]
 */
export async function logEvent({ userId = null, eventType, req, metadata = {} }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, eventType, req?.ip ?? null, req?.headers?.["user-agent"] ?? null, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error("[audit] failed to log event", eventType, err.message);
  }
}

export async function getAuditLogForUser(userId, { limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, event_type, ip_address, user_agent, metadata, created_at
     FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
