/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";

import { initSchema } from "./db/init.js";
import authRoutes from "./routes/auth.js";
import holdingsRoutes from "./routes/holdings.js";
import auditRoutes from "./routes/audit.js";
import stocksRoutes from "./routes/stocks.js";
import watchlistRoutes from "./routes/watchlist.js";
import notesRoutes from "./routes/notes.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

const app = express();

// --- Security-first middleware stack ------------------------------------
app.use(helmet()); // sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)

// The frontend is a plain static site (no dev server/bundler), so it may be
// opened directly as a file:// URL or served from any local static-file
// port. Allow common local origins, plus `null` for file:// pages, rather
// than pinning to one dev-server port.
const allowedOrigins = (
  process.env.CORS_ORIGIN || "http://localhost:5500,http://127.0.0.1:5500,null"
).split(",");

app.use(
  cors({
    origin: (origin, callback) => {
      // No origin header (e.g. curl, same-origin) is always allowed.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "20kb" })); // small limit mitigates body-based DoS
app.use(apiLimiter);

// Never trust proxies blindly in prod without configuring this properly,
// but needed for req.ip to work correctly behind most hosting platforms.
app.set("trust proxy", 1);

// --- Routes ---------------------------------------------------------------
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/holdings", holdingsRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/stocks", stocksRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/notes", notesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await initSchema();
    console.log("Connected to PostgreSQL and verified schema.");
  } catch (err) {
    console.error("Failed to connect to PostgreSQL:", err.message);
    console.error("Check DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) in your .env file.");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Personal Stock Portfolio API listening on http://localhost:${PORT}`);
  });
}

start();
