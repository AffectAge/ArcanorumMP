import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

function createClient() {
  return new PrismaClient();
}

export const prisma = globalForPrisma.__arcanorumPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__arcanorumPrisma = prisma;
}

export async function ensureDatabaseConnection() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Configure PostgreSQL connection string in environment.");
  }

  await prisma.$connect();
}
