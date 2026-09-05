/*
 * Personal Stock Portfolio (Backend)
 * Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.
 */

import speakeasy from "speakeasy";
import QRCode from "qrcode";

export function generateTotpSecret(email) {
  return speakeasy.generateSecret({
    name: `Personal Stock Portfolio (${email})`,
    length: 20,
  });
}

export async function generateQrCodeDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyTotpToken(secretBase32, token) {
  return speakeasy.totp.verify({
    secret: secretBase32,
    encoding: "base32",
    token,
    window: 1, // allow 1 step (30s) of clock drift
  });
}

