/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 *
 * Builds an .xlsx workbook from a user's decrypted holdings. Used both
 * for the on-demand "Export to Excel" download and for the auto-synced
 * copy written to disk whenever holdings data changes.
 */

import ExcelJS from "exceljs";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXPORTS_DIR = path.join(__dirname, "..", "..", "exports");

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

/**
 * @param {Array<{ticker: string, shares: number, costBasis: number, createdAt: string}>} holdings
 * @param {string} accountEmail
 */
export async function buildHoldingsWorkbook(holdings, accountEmail) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Personal Stock Portfolio";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Holdings");

  sheet.columns = [
    { header: "Ticker", key: "ticker", width: 12 },
    { header: "Shares", key: "shares", width: 14 },
    { header: "Cost Basis ($)", key: "costBasis", width: 16 },
    { header: "Position Value ($)", key: "positionValue", width: 20 },
    { header: "Added On", key: "createdAt", width: 22 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const h of holdings) {
    sheet.addRow({
      ticker: h.ticker,
      shares: h.shares,
      costBasis: h.costBasis,
      positionValue: Number((h.shares * h.costBasis).toFixed(2)),
      createdAt: h.createdAt,
    });
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.shares * h.costBasis, 0);
  const totalRow = sheet.addRow({
    ticker: "TOTAL",
    shares: "",
    costBasis: "",
    positionValue: Number(totalValue.toFixed(2)),
    createdAt: "",
  });
  totalRow.font = { bold: true };

  sheet.getColumn("costBasis").numFmt = "$#,##0.00";
  sheet.getColumn("positionValue").numFmt = "$#,##0.00";

  sheet.getCell("A" + (holdings.length + 4)).value = `Exported for: ${accountEmail}`;
  sheet.getCell("A" + (holdings.length + 4)).font = { italic: true, size: 10, color: { argb: "FF64748B" } };
  sheet.getCell("A" + (holdings.length + 5)).value = `Generated: ${new Date().toISOString()}`;
  sheet.getCell("A" + (holdings.length + 5)).font = { italic: true, size: 10, color: { argb: "FF64748B" } };

  return workbook;
}

/**
 * Regenerates the on-disk export file for a user. Called automatically
 * after any holding is created, updated, or deleted, so the Excel file
 * always mirrors what's currently in the database.
 */
export async function syncUserExcelExport(userId, accountEmail, holdings) {
  const workbook = await buildHoldingsWorkbook(holdings, accountEmail);
  const filePath = path.join(EXPORTS_DIR, `user-${userId}-holdings.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}
