-- CreateTable
CREATE TABLE "ColonizationProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countryId" TEXT NOT NULL,
    "provinceId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ColonizationProgress_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ColonizationProgress_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Country" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "flagImage" TEXT,
    "coatOfArmsImage" TEXT,
    "uiShowRegionLabels" BOOLEAN NOT NULL DEFAULT true,
    "colonizationPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Country" ("coatOfArmsImage", "color", "createdAt", "flagImage", "id", "name", "passwordHash", "uiShowRegionLabels") SELECT "coatOfArmsImage", "color", "createdAt", "flagImage", "id", "name", "passwordHash", "uiShowRegionLabels" FROM "Country";
DROP TABLE "Country";
ALTER TABLE "new_Country" RENAME TO "Country";
CREATE UNIQUE INDEX "Country_name_key" ON "Country"("name");
CREATE TABLE "new_Province" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerCountryId" TEXT,
    "contested" BOOLEAN NOT NULL DEFAULT false,
    "colonizationCost" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "Province_ownerCountryId_fkey" FOREIGN KEY ("ownerCountryId") REFERENCES "Country" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Province" ("contested", "id", "name", "ownerCountryId") SELECT "contested", "id", "name", "ownerCountryId" FROM "Province";
DROP TABLE "Province";
ALTER TABLE "new_Province" RENAME TO "Province";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ColonizationProgress_provinceId_idx" ON "ColonizationProgress"("provinceId");

-- CreateIndex
CREATE UNIQUE INDEX "ColonizationProgress_countryId_provinceId_key" ON "ColonizationProgress"("countryId", "provinceId");
