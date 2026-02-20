import express from "express";
import { listCountries, loginCountry, registerCountry } from "./authStore.js";

export function createHttpApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/countries", async (_req, res) => {
    try {
      const countries = await listCountries();
      res.json({ countries });
    } catch (error) {
      res.status(500).json({ error: error.message ?? "Failed to load countries" });
    }
  });

  app.post("/api/register", async (req, res) => {
    try {
      const result = await registerCountry(req.body ?? {});
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message ?? "Registration failed" });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const result = await loginCountry(req.body ?? {});
      res.status(200).json(result);
    } catch (error) {
      res.status(401).json({ error: error.message ?? "Login failed" });
    }
  });

  return app;
}
