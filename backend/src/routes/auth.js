/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import pool from "../db/init.js";
import { logEvent } from "../utils/audit.js";
import { generateTotpSecret, generateQrCodeDataUrl, verifyTotpToken } from "../utils/totp.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

const WRONG_PASSWORD_MESSAGE = "Please try again.";

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_TTL || "15m",
  });
}

async function issueRefreshToken(userId) {
  const rawToken = crypto.randomBytes(40).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return rawToken;
}

async function revokeAllRefreshTokens(userId) {
  await pool.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`, [userId]);
}

// --- Register ---------------------------------------------------------
router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { email, password } = parsed.data;

    const { rows: existingRows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existingRows.length > 0) {
      // Don't reveal whether the account exists in the response message.
      logEvent({ eventType: "REGISTER_DUPLICATE_ATTEMPT", req, metadata: { email } });
      return res.status(409).json({ error: "Unable to create account with those details." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [email, passwordHash]
    );

    logEvent({ userId: rows[0].id, eventType: "REGISTER_SUCCESS", req });
    res.status(201).json({ message: "Account created. Please log in." });
  } catch (err) {
    next(err);
  }
});

// --- Login (step 1: password) -----------------------------------------
router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: WRONG_PASSWORD_MESSAGE });
    }
    const { email, password } = parsed.data;

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = rows[0];

    if (!user) {
      logEvent({ eventType: "LOGIN_FAILED", req, metadata: { email, reason: "no_such_user" } });
      return res.status(401).json({ error: WRONG_PASSWORD_MESSAGE });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logEvent({ userId: user.id, eventType: "LOGIN_FAILED", req, metadata: { reason: "bad_password" } });
      return res.status(401).json({ error: WRONG_PASSWORD_MESSAGE });
    }

    if (user.totp_enabled) {
      // Issue a short-lived "pending" token that only allows hitting /login/2fa
      const pendingToken = jwt.sign(
        { sub: user.id, stage: "2fa_pending" },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: "5m" }
      );
      logEvent({ userId: user.id, eventType: "LOGIN_PASSWORD_OK_2FA_REQUIRED", req });
      return res.json({ twoFactorRequired: true, pendingToken });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    logEvent({ userId: user.id, eventType: "LOGIN_SUCCESS", req });
    res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

// --- Login (step 2: TOTP code) -----------------------------------------
router.post("/login/2fa", authLimiter, async (req, res, next) => {
  try {
    const { pendingToken, code } = req.body;
    if (!pendingToken || !code) {
      return res.status(400).json({ error: "pendingToken and code are required." });
    }

    let payload;
    try {
      payload = jwt.verify(pendingToken, process.env.JWT_ACCESS_SECRET);
    } catch {
      return res.status(401).json({ error: "2FA session expired. Please log in again." });
    }
    if (payload.stage !== "2fa_pending") {
      return res.status(401).json({ error: "Invalid session." });
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [payload.sub]);
    const user = rows[0];
    if (!user || !user.totp_enabled) {
      return res.status(400).json({ error: "2FA is not enabled for this account." });
    }

    const isValid = verifyTotpToken(user.totp_secret, code);
    if (!isValid) {
      logEvent({ userId: user.id, eventType: "LOGIN_2FA_FAILED", req });
      return res.status(401).json({ error: "Invalid authentication code." });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    logEvent({ userId: user.id, eventType: "LOGIN_SUCCESS_2FA", req });
    res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

// --- Enroll in 2FA (requires an authenticated session) ------------------
router.post("/2fa/setup", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    const secret = generateTotpSecret(user.email);

    await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [secret.base32, user.id]);

    const qrCodeDataUrl = await generateQrCodeDataUrl(secret.otpauth_url);
    logEvent({ userId: user.id, eventType: "2FA_SETUP_INITIATED", req });
    res.json({ qrCodeDataUrl, manualEntryKey: secret.base32 });
  } catch (err) {
    next(err);
  }
});

router.post("/2fa/verify", requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body;
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];

    if (!user.totp_secret) {
      return res.status(400).json({ error: "Call /2fa/setup first." });
    }
    if (!verifyTotpToken(user.totp_secret, code)) {
      return res.status(401).json({ error: "Invalid code." });
    }

    await pool.query("UPDATE users SET totp_enabled = TRUE WHERE id = $1", [user.id]);
    logEvent({ userId: user.id, eventType: "2FA_ENABLED", req });
    res.json({ message: "Two-factor authentication enabled." });
  } catch (err) {
    next(err);
  }
});

// --- Refresh access token, with rotation --------------------------------
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "refreshToken required." });

    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const { rows } = await pool.query(
      "SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked = FALSE",
      [tokenHash]
    );
    const record = rows[0];

    if (!record || new Date(record.expires_at) < new Date()) {
      return res.status(401).json({ error: "Refresh token invalid or expired." });
    }

    // Rotate: revoke old, issue new — limits damage from a leaked token.
    await pool.query("UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1", [record.id]);

    const { rows: userRows } = await pool.query("SELECT * FROM users WHERE id = $1", [record.user_id]);
    const user = userRows[0];
    const accessToken = signAccessToken(user);
    const newRefreshToken = await issueRefreshToken(user.id);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
});

// --- Logout: revoke refresh token ---------------------------------------
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      await pool.query("UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1", [tokenHash]);
    }
    logEvent({ userId: req.user.id, eventType: "LOGOUT", req });
    res.json({ message: "Logged out." });
  } catch (err) {
    next(err);
  }
});

// --- Change password (requires being logged in) --------------------------
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, "New password must be at least 10 characters"),
});

router.post("/change-password", requireAuth, authLimiter, async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { currentPassword, newPassword } = parsed.data;

    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      logEvent({ userId: user.id, eventType: "CHANGE_PASSWORD_FAILED", req });
      return res.status(401).json({ error: WRONG_PASSWORD_MESSAGE });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);

    // Force re-login everywhere else, since the old password could have
    // been compromised — this is standard practice after a password change.
    await revokeAllRefreshTokens(user.id);

    logEvent({ userId: user.id, eventType: "PASSWORD_CHANGED", req });
    res.json({ message: "Password changed. Please log in again." });
  } catch (err) {
    next(err);
  }
});

// --- Forgot password: request a reset link --------------------------------
const forgotPasswordSchema = z.object({ email: z.string().email() });

router.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    const { email } = parsed.data;

    // Always respond the same way whether or not the account exists —
    // this prevents attackers from using this endpoint to discover which
    // emails are registered.
    const genericResponse = {
      message: "If an account exists for that email, a password reset link has been sent.",
    };

    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    const user = rows[0];

    if (!user) {
      logEvent({ eventType: "FORGOT_PASSWORD_UNKNOWN_EMAIL", req, metadata: { email } });
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5500"}/#/reset-password?token=${rawToken}`;

    // No email provider is configured in this project. In a production
    // deployment, send `resetLink` via a transactional email service
    // (e.g. Resend, SendGrid, Postmark) instead of logging it.
    console.log(`\n[password reset] Reset link for ${email}:\n${resetLink}\n`);

    logEvent({ userId: user.id, eventType: "FORGOT_PASSWORD_REQUESTED", req });

    const response = { ...genericResponse };
    if (process.env.NODE_ENV !== "production") {
      // Dev convenience only: surface the link directly so the flow is
      // testable without setting up an email provider. Remove this in
      // any real deployment — see SECURITY.md.
      response.devResetLink = resetLink;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// --- Reset password using a token from the emailed link --------------------
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10, "New password must be at least 10 characters"),
});

router.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { token, newPassword } = parsed.data;

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query(
      `SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used = FALSE`,
      [tokenHash]
    );
    const record = rows[0];

    if (!record || new Date(record.expires_at) < new Date()) {
      logEvent({ eventType: "PASSWORD_RESET_INVALID_TOKEN", req });
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, record.user_id]);
    await pool.query("UPDATE password_reset_tokens SET used = TRUE WHERE id = $1", [record.id]);
    await revokeAllRefreshTokens(record.user_id);

    logEvent({ userId: record.user_id, eventType: "PASSWORD_RESET_SUCCESS", req });
    res.json({ message: "Password reset. Please log in with your new password." });
  } catch (err) {
    next(err);
  }
});

export default router;
