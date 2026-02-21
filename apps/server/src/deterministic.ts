import crypto from "node:crypto";

export function hashToScore(value: string): number {
  return Number.parseInt(crypto.createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}
