import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Response } from "express";
import { config } from "./config.js";
import { prisma } from "./prisma.js";

const COOKIE_NAME = "wego_token";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, originalHash] = stored.split(":");
  if (!salt || !originalHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(originalHash));
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueSession(countryId: string, response: Response) {
  const token = jwt.sign({ countryId }, config.jwtSecret, { expiresIn: "7d" });
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { countryId, tokenHash, expiresAt }
  });

  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    expires: expiresAt
  });
}

export async function clearSession(token: string | undefined, response: Response) {
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  response.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: false
  });
}

export async function resolveCountryFromToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { countryId?: string };
    if (!payload.countryId) return null;

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) }
    });

    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.session.delete({ where: { id: session.id } });
      return null;
    }

    return payload.countryId;
  } catch {
    return null;
  }
}

export const authCookieName = COOKIE_NAME;
