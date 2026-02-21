import "dotenv/config";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: envNumber("PORT", 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "change_me",
  planningDurationMs: envNumber("PLANNING_DURATION_MS", 120000),
  resolveDurationMs: envNumber("RESOLVE_DURATION_MS", 3000),
  commitDurationMs: envNumber("COMMIT_DURATION_MS", 2000)
};
