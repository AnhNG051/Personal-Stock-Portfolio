/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

// Keep error responses generic in production so we never leak stack traces
// or internal details to a client — a common source of information disclosure.
export function errorHandler(err, req, res, next) {
  console.error(err);

  const isProd = process.env.NODE_ENV === "production";
  const status = err.status || 500;

  res.status(status).json({
    error: isProd ? "Something went wrong." : err.message,
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Not found" });
}

