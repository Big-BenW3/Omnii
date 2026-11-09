#!/usr/bin/env node
/**
 * Devnet guard (spec sections 2.2, 17.4): Concord is Devnet-only through
 * Phase 6. This script validates apps/web/.env.example (always) and
 * apps/web/.env.local (when present) before dev, CI, and deploy.
 *
 * Checks:
 *  - NEXT_PUBLIC_SOLANA_CLUSTER is devnet or localnet (never mainnet/testnet)
 *  - no RPC URL mentions mainnet
 *  - .env.local has no .env.example placeholders and has real secrets
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const WEB_DIR = path.join(process.cwd(), "apps", "web");
const CLUSTERS = new Set(["devnet", "localnet"]);
const PLACEHOLDER = /^replace-with/i;

let failed = false;

function parseEnvFile(file) {
  if (!existsSync(file)) return null;
  const out = {};
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function err(file, message) {
  failed = true;
  console.error(
    `devnet-guard: ${path.relative(process.cwd(), file)}: ${message}`
  );
}

function warn(file, message) {
  console.warn(
    `devnet-guard: ${path.relative(process.cwd(), file)}: warning: ${message}`
  );
}

function checkCluster(env, file, isExample) {
  const cluster = env.NEXT_PUBLIC_SOLANA_CLUSTER;
  if (!cluster) {
    if (!isExample)
      warn(
        file,
        "NEXT_PUBLIC_SOLANA_CLUSTER is unset (defaults to devnet in code)"
      );
  } else if (!CLUSTERS.has(cluster)) {
    err(
      file,
      `NEXT_PUBLIC_SOLANA_CLUSTER="${cluster}" is forbidden; use devnet (localnet allowed for tests only)`
    );
  }
}

function checkRpcUrls(env, file) {
  for (const key of [
    "NEXT_PUBLIC_SOLANA_RPC_URL",
    "MAGICBLOCK_BASE_RPC_URL",
    "MAGICBLOCK_ER_RPC_URL",
    "MAGICBLOCK_PER_RPC_URL",
  ]) {
    const value = env[key];
    if (!value) continue;
    if (/mainnet/i.test(value)) {
      err(
        file,
        `${key} points at mainnet ("${value}"); this product is Devnet-only`
      );
    }
  }
}

function checkNoPlaceholders(env, file) {
  for (const [key, value] of Object.entries(env)) {
    if (PLACEHOLDER.test(value)) {
      err(file, `${key} is still a placeholder; set a real value`);
    }
  }
}

function checkLocalSecrets(env, file) {
  for (const key of ["SESSION_SECRET", "INVITE_HASH_SECRET"]) {
    const value = env[key];
    if (!value) {
      err(
        file,
        `${key} is required in .env.local (min 32 chars, generate with: openssl rand -hex 32)`
      );
    } else if (value.length < 32) {
      err(file, `${key} must be at least 32 characters`);
    }
  }
  if (!env.DATABASE_URL) {
    err(file, "DATABASE_URL is required in .env.local");
  } else if (!env.DATABASE_URL.startsWith("postgresql://")) {
    err(file, "DATABASE_URL must be a postgresql:// URL");
  }
  if (env.LIVEKIT_API_SECRET && env.LIVEKIT_API_SECRET.length < 16) {
    err(file, "LIVEKIT_API_SECRET looks too short");
  }
}

function checkVrfQueue(env, file, isExample) {
  const queue = env.MAGICBLOCK_VRF_QUEUE;
  if (!queue || PLACEHOLDER.test(queue)) return;
  const knownDevnet = new Set([
    "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh", // base-layer Devnet queue
    "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc", // delegated (ER) Devnet queue
  ]);
  if (!knownDevnet.has(queue) && !isExample) {
    warn(
      file,
      `MAGICBLOCK_VRF_QUEUE is not a documented Devnet queue; verify against current MagicBlock docs`
    );
  }
}

const exampleFile = path.join(WEB_DIR, ".env.example");
const localFile = path.join(WEB_DIR, ".env.local");

const example = parseEnvFile(exampleFile);
if (!example) {
  err(exampleFile, "missing .env.example");
} else {
  checkCluster(example, exampleFile, true);
  checkRpcUrls(example, exampleFile);
}

const local = parseEnvFile(localFile);
if (local) {
  checkCluster(local, localFile, false);
  checkRpcUrls(local, localFile);
  checkNoPlaceholders(local, localFile);
  checkLocalSecrets(local, localFile);
  checkVrfQueue(local, localFile, false);
} else {
  console.log(
    "devnet-guard: no apps/web/.env.local found (ok for CI; required for dev with a database)"
  );
}

if (failed) {
  process.exit(1);
}
console.log("devnet-guard: ok");
