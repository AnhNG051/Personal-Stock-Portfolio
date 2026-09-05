/*
 * Personal Stock Portfolio
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 *
 * A minimal static file server for local development, built entirely
 * from Node's own built-in modules (http, fs, path). No npm packages,
 * no "serve"/"http-server" dependency — nothing to install.
 *
 * Usage: node serve.js [port]   (defaults to port 5500)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 5500;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // Strip query string, default to index.html for the root path
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(__dirname, decodeURIComponent(urlPath));

  // Prevent path traversal outside the frontend folder
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Personal Stock Portfolio frontend served at http://localhost:${PORT}`);
});
