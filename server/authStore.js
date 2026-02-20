import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "./db.js";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

function normalizeCountryName(name) {
  return `${name ?? ""}`.trim().replace(/\s+/g, " ").slice(0, 32);
}

function validateCountryName(name) {
  return name.length >= 2;
}

function normalizeColor(color) {
  const cleaned = `${color ?? ""}`.trim();
  const withHash = cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
  return withHash.slice(0, 7).toUpperCase();
}

function validateColor(color) {
  return /^#[0-9A-F]{6}$/i.test(color);
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function makeCountryId(name) {
  return createHash("sha1").update(name.toLowerCase()).digest("hex").slice(0, 12);
}

async function cleanupExpiredTokens() {
  await prisma.sessionToken.deleteMany({
    where: {
      expiresAt: {
        lte: new Date(),
      },
    },
  });
}

async function issueToken(countryId) {
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await prisma.sessionToken.create({
    data: {
      countryId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return token;
}

function sanitizeCountry(country) {
  return {
    id: country.id,
    name: country.name,
    color: country.color,
    createdAt: country.createdAt.getTime(),
  }
}

export async function listCountries() {
  const countries = await prisma.country.findMany({
    orderBy: { name: "asc" },
  });

  return countries
    .map(sanitizeCountry);
}

export async function registerCountry({ name, color, password }) {
  const normalizedName = normalizeCountryName(name);
  const normalizedNameKey = normalizedName.toLowerCase();
  const normalizedColor = normalizeColor(color);
  const normalizedPassword = `${password ?? ""}`;

  if (!validateCountryName(normalizedName)) {
    throw new Error("Country name must be at least 2 characters.");
  }

  if (!validateColor(normalizedColor)) {
    throw new Error("Color must be a valid hex color (#RRGGBB).");
  }

  if (normalizedPassword.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }

  const existingCountry = await prisma.country.findFirst({
    where: {
      OR: [{ nameKey: normalizedNameKey }, { name: normalizedName }],
    },
    select: { id: true },
  });

  if (existingCountry) {
    throw new Error("Country already exists.");
  }

  const id = makeCountryId(normalizedName);
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(normalizedPassword, salt);

  const country = await prisma.country.create({
    data: {
      id,
      name: normalizedName,
      nameKey: normalizedNameKey,
      color: normalizedColor,
      passwordSalt: salt,
      passwordHash: passwordHash.toString("base64"),
    },
  });

  const token = await issueToken(id);

  return {
    token,
    country: sanitizeCountry(country),
  };
}

export async function loginCountry({ countryId, password }) {
  const normalizedPassword = `${password ?? ""}`;
  const country = await prisma.country.findUnique({
    where: {
      id: `${countryId ?? ""}`.trim(),
    },
  });

  if (!country) {
    throw new Error("Country not found.");
  }

  const computed = hashPassword(normalizedPassword, country.passwordSalt);
  const storedHash = Buffer.from(country.passwordHash, "base64");
  if (storedHash.length !== computed.length || !timingSafeEqual(computed, storedHash)) {
    throw new Error("Invalid password.");
  }

  const token = await issueToken(country.id);

  return {
    token,
    country: sanitizeCountry(country),
  };
}

export async function getSessionByToken(token) {
  await cleanupExpiredTokens();

  const tokenHash = hashToken(`${token ?? ""}`.trim());
  const session = await prisma.sessionToken.findUnique({
    where: { tokenHash },
    include: { country: true },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (!session.country) {
    return null;
  }

  return {
    countryId: session.country.id,
    countryName: session.country.name,
    countryColor: session.country.color,
  };
}
