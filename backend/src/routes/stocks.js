/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 *
 * Proxies stock market data from Finnhub. The API key stays server-side
 * (never sent to the browser), and responses are cached briefly in
 * memory to stay comfortably under Finnhub's free-tier rate limit
 * (60 requests/min) when multiple pages request the same ticker.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const TICKER_PATTERN = /^[A-Za-z.]{1,10}$/;

// Simple in-memory cache: { key: { data, expiresAt } }
const cache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds — fresh enough for a dashboard, gentle on rate limits

function getCached(key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.data;
}

function setCached(key, data, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function fetchFinnhub(path, params) {
  const apiKey = process.env.STOCK_API_KEY;
  if (!apiKey || apiKey === "your_finnhub_or_alphavantage_key") {
    const err = new Error(
      "No Finnhub API key configured. Add STOCK_API_KEY to backend/.env to enable live stock data."
    );
    err.status = 503;
    throw err;
  }

  const url = new URL(`${FINNHUB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("token", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Finnhub request failed (${res.status})`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  return res.json();
}

function validateTicker(req, res) {
  const ticker = (req.params.symbol || "").toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) {
    res.status(400).json({ error: "Invalid ticker symbol." });
    return null;
  }
  return ticker;
}

// Full US exchange symbol list (NASDAQ, NYSE, AMEX) — thousands of real,
// currently-listed tickers. One Finnhub call returns the whole list, so
// it's cached for 24h rather than per-symbol.
router.get("/symbols", async (req, res, next) => {
  try {
    const cacheKey = "symbols:US";
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const raw = await fetchFinnhub("/stock/symbol", { exchange: "US" });

    const symbols = raw
      .filter((s) => s.type === "Common Stock" && s.symbol && !s.symbol.includes("."))
      .map((s) => ({ symbol: s.symbol, name: s.description }));

    setCached(cacheKey, symbols, 24 * 60 * 60 * 1000);
    res.json(symbols);
  } catch (err) {
    next(err);
  }
});

// --- Live quote: current price, daily change ------------------------------
router.get("/quote/:symbol", async (req, res, next) => {
  try {
    const ticker = validateTicker(req, res);
    if (!ticker) return;

    const cacheKey = `quote:${ticker}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const raw = await fetchFinnhub("/quote", { symbol: ticker });

    // Finnhub returns all-zero fields for an unrecognized ticker rather
    // than an error status, so treat that shape as "not found".
    if (raw.c === 0 && raw.pc === 0) {
      return res.status(404).json({ error: `No quote data found for ${ticker}.` });
    }

    const quote = {
      ticker,
      currentPrice: raw.c,
      change: raw.d,
      percentChange: raw.dp,
      high: raw.h,
      low: raw.l,
      open: raw.o,
      previousClose: raw.pc,
      asOf: raw.t,
    };

    setCached(cacheKey, quote);
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

// --- Company profile: name, industry, logo, market cap --------------------
router.get("/profile/:symbol", async (req, res, next) => {
  try {
    const ticker = validateTicker(req, res);
    if (!ticker) return;

    const cacheKey = `profile:${ticker}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const raw = await fetchFinnhub("/stock/profile2", { symbol: ticker });

    if (!raw || !raw.name) {
      return res.status(404).json({ error: `No company profile found for ${ticker}.` });
    }

    const profile = {
      ticker,
      companyName: raw.name,
      industry: raw.finnhubIndustry,
      logoUrl: raw.logo,
      marketCapitalization: raw.marketCapitalization,
      exchange: raw.exchange,
      currency: raw.currency,
      ipoDate: raw.ipo,
      website: raw.weburl,
    };

    // Company profile data changes rarely — cache it much longer than quotes.
    setCached(cacheKey, profile, 60 * 60 * 1000); // 1 hour
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// --- Historical daily candles for the price chart --------------------------
router.get("/candles/:symbol", async (req, res, next) => {
  try {
    const ticker = validateTicker(req, res);
    if (!ticker) return;

    const days = Math.min(Number(req.query.days) || 90, 365);
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 24 * 60 * 60;

    const cacheKey = `candles:${ticker}:${days}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const raw = await fetchFinnhub("/stock/candle", {
      symbol: ticker,
      resolution: "D",
      from,
      to,
    });

    if (raw.s !== "ok" || !Array.isArray(raw.c) || raw.c.length === 0) {
      // Finnhub's free tier sometimes restricts historical candles;
      // surface this clearly rather than showing a broken chart.
      return res.status(404).json({
        error: `No historical price data available for ${ticker} (this can happen on Finnhub's free tier for some symbols).`,
      });
    }

    const candles = raw.t.map((timestamp, i) => ({
      date: timestamp,
      open: raw.o[i],
      high: raw.h[i],
      low: raw.l[i],
      close: raw.c[i],
      volume: raw.v[i],
    }));

    const payload = { ticker, candles };
    setCached(cacheKey, payload, 5 * 60 * 1000); // 5 minutes — historical data doesn't change intraday
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
