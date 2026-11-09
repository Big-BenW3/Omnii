// Applies the real Drizzle migrations to an embedded PGlite database on disk.
// Usage: node scripts/migrate-local.mjs <dataDir>   (default .data/pglite)
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdirSync } from "node:fs";

const dir = process.argv[2] ?? ".data/pglite";
mkdirSync(dir, { recursive: true });
const client = new PGlite(dir);
await migrate(drizzle(client), { migrationsFolder: "app/lib/db/migrations" });
await client.close();
console.log(`migrated pglite database at ${dir}`);
