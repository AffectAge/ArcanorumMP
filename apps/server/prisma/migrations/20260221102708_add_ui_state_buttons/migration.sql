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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Country" ("coatOfArmsImage", "color", "createdAt", "flagImage", "id", "name", "passwordHash") SELECT "coatOfArmsImage", "color", "createdAt", "flagImage", "id", "name", "passwordHash" FROM "Country";
DROP TABLE "Country";
ALTER TABLE "new_Country" RENAME TO "Country";
CREATE UNIQUE INDEX "Country_name_key" ON "Country"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
