import fs from "node:fs/promises";
import path from "node:path";

type GeoFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: unknown;
};

type GeoCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

const CACHE_PATH = path.resolve(process.cwd(), "data", "world-adm1.geojson");

let inMemoryCache: GeoCollection | null = null;

export async function getWorldAdm1GeoJson(): Promise<GeoCollection> {
  if (inMemoryCache) return inMemoryCache;

  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as GeoCollection;
    inMemoryCache = parsed;
    return parsed;
  } catch (error) {
    throw new Error(
      `Локальный файл карты не найден или поврежден: ${CACHE_PATH}. ${error instanceof Error ? error.message : ""}`.trim()
    );
  }
}
