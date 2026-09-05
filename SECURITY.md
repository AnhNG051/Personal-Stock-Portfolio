# Security design notes

This document explains the threat model behind Personal Stock Portfolio's
design choices — partly so contributors understand *why* things are built
this way, and partly because writing this down is itself good practice
before shipping anything that handles user data.

## What we're protecting

- **Account credentials** — email + password, and TOTP secrets for 2FA.
- **Portfolio data** — share counts and cost basis per holding. Not
  regulated financial data, but still information a user would consider
  private (it implies their net worth and trading behavior).
- **Session integrity** — preventing an attacker from acting as a logged-in
  user, or from riding a stolen session indefinitely.

## Key threats and mitigations

| Threat | Mitigation |
|---|---|
| Password database leak | Passwords hashed with bcrypt (cost factor 12), never stored or logged in plaintext |
| Database/backup theft exposing holdings | `shares` and `cost_basis` encrypted at rest with AES-256-GCM before being written to PostgreSQL |
| Stolen access token | Access tokens are short-lived (15 min default) and stateless — a stolen one expires quickly |
| Stolen refresh token | Refresh tokens are single-use and rotated on every refresh; only a SHA-256 hash is stored server-side, so a database read alone can't be replayed as a valid token |
| Credential stuffing / brute force | `express-rate-limit` caps auth endpoints (login, register, change-password, forgot-password, reset-password) to 10 requests / 15 min per IP |
| Account takeover via password alone | Optional TOTP 2FA; once enabled, login requires both password and a time-based code |
| Cross-user data access | Every database query in `holdings.js` and `audit.js` is scoped by `WHERE user_id = $1` using the ID from the verified JWT — there is no endpoint that accepts a client-supplied user ID |
| XSS/clickjacking via response headers | `helmet()` sets CSP, X-Frame-Options, and related headers by default |
| Malformed/oversized request bodies | Zod schema validation on every write; `express.json({ limit: "20kb" })` caps body size |
| Silent tampering going unnoticed | Every auth event and portfolio mutation is written to `audit_log` with timestamp, IP, and user agent, visible to the account owner in the dashboard |
| Information disclosure via error messages | Login failures (unknown email or wrong password) return the same generic "Please try again." message, so they don't confirm whether an email is registered |
| Account enumeration via forgot-password | `/auth/forgot-password` always returns the same generic response regardless of whether the email exists, and only logs the reset link server-side (or returns it in the response outside production, for local testing) |
| Reused/stolen password reset link | Reset tokens are single-use (`used` flag), expire after 30 minutes, and only a SHA-256 hash is stored — same pattern as refresh tokens |
| Attacker with a stolen session changing account details unnoticed | Both `change-password` and `reset-password` revoke **all** existing refresh tokens for the account, forcing re-login everywhere — so a password change or reset immediately kicks out any other active session |
| Guessing the current password during a change-password request | Requires the correct current password, verified with bcrypt, before any change is applied; wrong attempts return the same generic "Please try again." message and are logged to the audit trail |
| Exposing a paid API key in client-side code | The Finnhub API key lives only in the backend's `.env` and is never sent to the browser — the frontend calls `/api/stocks/...` on our own backend, which attaches the key server-side before forwarding the request to Finnhub |

## What this project intentionally does NOT cover

Being upfront about scope is part of a real threat model:

- **No real email delivery** — the forgot-password flow generates and
  validates reset tokens correctly, but there's no SMTP/email provider
  wired up. The reset link is logged to the server console (and returned
  directly in the API response when `NODE_ENV` isn't `production`) purely
  so the flow is testable locally. A real deployment should send this via
  a transactional email service (e.g. Resend, SendGrid, Postmark) instead.
- **No WAF / DDoS protection** — this is an application, not infrastructure;
  that's a hosting-layer concern (e.g. Cloudflare in front of it).
- **No secrets manager** — `.env` is fine for a portfolio project; a real
  deployment should use a vault (AWS Secrets Manager, Doppler, etc.) instead
  of an env file on disk.
- **No key rotation strategy** — `FIELD_ENCRYPTION_KEY` is static. A
  production system would need versioned keys and a re-encryption path.
- **No formal penetration test** — this repo demonstrates security-conscious
  patterns, not a certified-secure system. Treat it as a strong baseline,
  not a finished audit.

## Reporting a vulnerability

This is a personal/portfolio project. If you spot an issue, open a GitHub
issue or reach out directly rather than filing a public exploit.
