#!/usr/bin/env node
/**
 * Fails if any server secret value appears in the browser bundle (spec 17.1 #25).
 * Run after `pnpm build`. Reads secret values from the environment and from
 * apps/web/.env.local when present; never prints the values themselves.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SECRET_KEYS = [
  "LIVEKIT_API_SECRET",
  "LIVEKIT_API_KEY",
  "SESSION_SECRET",
  "INVITE_HASH_SECRET",
  "DATABASE_URL",
  "DATABASE_URL_POOLED",
  "CRON_SECRET",
  "CONCORD_E2E_SEED_SECRET",
];

function envFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...envFile("apps/web/.env.local"), ...process.env };
const secrets = SECRET_KEYS.map((k) => [k, env[k]]).filter(([, v]) => v && v.length >= 8 && !v.startsWith("replace-with"));
const staticDir = "apps/web/.next/static";
if (!existsSync(staticDir)) {
  console.error("check-bundle-secrets: run `pnpm build` first");
  process.exit(2);
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

let leaks = 0;
let scanned = 0;
for (const file of files(staticDir)) {
  scanned++;
  const text = readFileSync(file, "utf8");
  for (const [key, value] of secrets) {
    if (text.includes(value)) {
      console.error(`LEAK: ${key} found in ${file}`);
      leaks++;
    }
  }
}
console.log(`check-bundle-secrets: scanned ${scanned} client files for ${secrets.length} secrets: ${leaks ? `${leaks} LEAK(S)` : "clean"}`);
process.exit(leaks ? 1 : 0);
