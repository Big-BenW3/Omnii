import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Driver selection by DATABASE_URL:
 * - `pglite:<dir>`  embedded Postgres on disk (local dev / E2E; migrate first with
 *                   `pnpm db:migrate:local`). No network needed.
 * - `*.neon.tech`   Neon serverless driver over WebSockets (port 443). Works where
 *                   outbound 5432 is blocked and is Neon's recommended driver for Vercel.
 * - otherwise       node-postgres over TCP.
 */
function createDb() {
  const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!url) return null;

  if (url.startsWith("pglite:")) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { PGlite } = require("@electric-sql/pglite");
    const { drizzle } = require("drizzle-orm/pglite");
    /* eslint-enable @typescript-eslint/no-require-imports */
    return drizzle(new PGlite(url.slice("pglite:".length)), { schema }) as ReturnType<typeof drizzlePg<typeof schema>>;
  }

  if (/\.neon\.tech/.test(url)) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { Pool: NeonPool, neonConfig } = require("@neondatabase/serverless");
    const { drizzle } = require("drizzle-orm/neon-serverless");
    neonConfig.webSocketConstructor = require("ws");
    /* eslint-enable @typescript-eslint/no-require-imports */
    return drizzle(new NeonPool({ connectionString: url, max: 5 }), { schema }) as ReturnType<typeof drizzlePg<typeof schema>>;
  }

  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000 });
  return drizzlePg(pool, { schema });
}

export type Db = NonNullable<ReturnType<typeof createDb>>;

let instance: Db | null | undefined;

/** Lazily created database handle. Tests may inject one with `setDbForTests`. */
export function getDb(): Db {
  if (instance === undefined) instance = createDb();
  if (!instance) throw new Error("DATABASE_URL is not configured");
  return instance;
}

export function setDbForTests(db: Db) {
  instance = db;
}
