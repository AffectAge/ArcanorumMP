import http from "node:http";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { loginSchema, registerSchema, submitOrderSchema } from "@wego/shared";
import { config } from "./config.js";
import {
  authCookieName,
  clearSession,
  hashPassword,
  issueSession,
  resolveCountryFromToken,
  verifyPassword
} from "./auth.js";
import { WeGoEngine } from "./game-engine.js";
import { getWorldAdm1GeoJson } from "./map-data.js";
import { prisma } from "./prisma.js";

const app = express();

app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.clientOrigin,
    credentials: true
  }
});

const engine = new WeGoEngine(io);

async function authCountryId(req: express.Request): Promise<string | null> {
  const token = req.cookies?.[authCookieName] as string | undefined;
  return resolveCountryFromToken(token);
}

app.get("/api/countries", async (_req, res) => {
  const countries = await prisma.country.findMany({
    select: { id: true, name: true, color: true, flagImage: true, coatOfArmsImage: true },
    orderBy: { name: "asc" }
  });

  res.json({ countries });
});

app.get("/api/map/adm1", async (_req, res) => {
  try {
    const geojson = await getWorldAdm1GeoJson();
    res.json(geojson);
  } catch (error) {
    res.status(500).json({
      error: "map_load_failed",
      message: error instanceof Error ? error.message : "Не удалось загрузить карту ADM1"
    });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const countryId = await authCountryId(req);
  if (!countryId) {
    res.json({ country: null });
    return;
  }

  const country = await prisma.country.findUnique({
    where: { id: countryId },
    select: { id: true, name: true, color: true, flagImage: true, coatOfArmsImage: true }
  });

  if (!country) {
    res.json({ country: null });
    return;
  }

  res.json({ country });
});

app.post("/api/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_payload",
      details: parsed.error.flatten()
    });
    return;
  }

  const exists = await prisma.country.findUnique({
    where: { name: parsed.data.countryName }
  });

  if (exists) {
    res.status(409).json({ error: "country_exists" });
    return;
  }

  const country = await prisma.country.create({
    data: {
      name: parsed.data.countryName,
      color: parsed.data.color,
      flagImage: parsed.data.flagImage,
      coatOfArmsImage: parsed.data.coatOfArmsImage,
      passwordHash: hashPassword(parsed.data.password)
    },
    select: { id: true, name: true, color: true, flagImage: true, coatOfArmsImage: true }
  });

  await issueSession(country.id, res);
  res.status(201).json({ country });
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_payload",
      details: parsed.error.flatten()
    });
    return;
  }

  const country = await prisma.country.findUnique({
    where: { name: parsed.data.countryName }
  });

  if (!country || !verifyPassword(parsed.data.password, country.passwordHash)) {
    res.status(401).json({ error: "bad_credentials" });
    return;
  }

  await issueSession(country.id, res);
  res.json({
    country: {
      id: country.id,
      name: country.name,
      color: country.color,
      flagImage: country.flagImage,
      coatOfArmsImage: country.coatOfArmsImage
    }
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies?.[authCookieName] as string | undefined;
  await clearSession(token, res);
  res.status(204).end();
});

app.get("/api/game/state", async (req, res) => {
  const countryId = await authCountryId(req);
  if (!countryId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const state = await engine.getPublicState();
  res.json(state);
});

app.post("/api/game/orders", async (req, res) => {
  const countryId = await authCountryId(req);
  if (!countryId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = submitOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  try {
    await engine.submitOrder(countryId, parsed.data);
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "order_failed" });
  }
});

app.post("/api/game/ready", async (req, res) => {
  const countryId = await authCountryId(req);
  if (!countryId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  await engine.markReady(countryId);
  res.status(201).json({ ok: true });
});

io.use(async (socket, next) => {
  const rawCookie = socket.handshake.headers.cookie;
  if (!rawCookie) {
    next(new Error("unauthorized"));
    return;
  }

  const tokenPair = rawCookie.split(";").map((item) => item.trim()).find((part) => part.startsWith(`${authCookieName}=`));
  const token = tokenPair?.split("=")[1];

  const countryId = await resolveCountryFromToken(token);
  if (!countryId) {
    next(new Error("unauthorized"));
    return;
  }

  socket.data.countryId = countryId;
  next();
});

io.on("connection", async (socket) => {
  socket.join("global");
  socket.emit("game:state", await engine.getPublicState());
});

await engine.init();

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`WeGo server started on http://localhost:${config.port}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
