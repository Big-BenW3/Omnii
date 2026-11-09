import { z } from "zod";

/**
 * Concord environment contracts (spec sections 10, 12.1, 20).
 *
 * The product runs Devnet-only through Phase 6. Mainnet and testnet values
 * are rejected here and by scripts/devnet-guard.mjs. Placeholders from
 * .env.example are rejected by `parse*Env` when `allowPlaceholders` is false.
 */

export const SOLANA_CLUSTERS = ["devnet", "localnet"] as const;
export type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];

const base58 = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address");

const placeholderMarker = "replace-with";

function notPlaceholder(value: string, ctx: z.RefinementCtx, allow: boolean) {
  if (!allow && value.toLowerCase().startsWith(placeholderMarker)) {
    ctx.addIssue({
      code: "custom",
      message: "still a .env.example placeholder; set a real value",
    });
    return z.NEVER;
  }
  return value;
}

/** Server-side environment (never exposed to the client bundle). */
export const serverEnvSchema = z
  .object({
    APP_BASE_URL: z.url().default("http://localhost:3000"),
    SESSION_SECRET: z.string().min(32),
    INVITE_HASH_SECRET: z.string().min(32),
    /** postgresql:// in deployed environments; `pglite:<dir>` (embedded) for local dev and E2E. */
    DATABASE_URL: z
      .string()
      .refine((u) => u.startsWith("postgresql://") || u.startsWith("pglite:"), "must be postgresql:// or pglite:<dir>"),
    /** Pooled connection string (Neon pgbouncer). Preferred by the app at runtime. */
    DATABASE_URL_POOLED: z.string().startsWith("postgresql://").optional(),
    CONCORD_PROGRAM_ID: base58,
    MAGICBLOCK_BASE_RPC_URL: z.url(),
    /** Magic Router (routes to the ER that owns a delegated account). */
    MAGICBLOCK_ER_RPC_URL: z.url(),
    /** TEE-backed Private Ephemeral Rollup endpoint. */
    MAGICBLOCK_PER_RPC_URL: z.url(),
    MAGICBLOCK_VRF_QUEUE: base58,
    LIVEKIT_URL: z.url(),
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),
    /** Shared secret for the expiry cron endpoint. Optional in dev. */
    CRON_SECRET: z.string().min(32).optional(),
  })
  .superRefine((val, ctx) => {
    for (const key of [
      "SESSION_SECRET",
      "INVITE_HASH_SECRET",
      "CONCORD_PROGRAM_ID",
      "MAGICBLOCK_BASE_RPC_URL",
      "MAGICBLOCK_ER_RPC_URL",
      "MAGICBLOCK_PER_RPC_URL",
      "MAGICBLOCK_VRF_QUEUE",
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
    ] as const) {
      notPlaceholder(val[key], ctx, false);
    }
    if (
      /mainnet/i.test(val.MAGICBLOCK_BASE_RPC_URL) ||
      /mainnet/i.test(val.MAGICBLOCK_ER_RPC_URL) ||
      /mainnet/i.test(val.MAGICBLOCK_PER_RPC_URL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MAGICBLOCK_BASE_RPC_URL"],
        message: "mainnet endpoints are forbidden; this product is Devnet-only",
      });
    }
  });

/** Public (NEXT_PUBLIC_*) environment, inlined into the client bundle. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SOLANA_CLUSTER: z.enum(SOLANA_CLUSTERS).default("devnet"),
  NEXT_PUBLIC_SOLANA_RPC_URL: z.url().refine((u) => !/mainnet/i.test(u), {
    message: "mainnet RPC is forbidden; this product is Devnet-only",
  }),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

type EnvSource = Record<string, string | undefined>;

export const SERVER_ENV_KEYS = [
  "APP_BASE_URL",
  "SESSION_SECRET",
  "INVITE_HASH_SECRET",
  "DATABASE_URL",
  "DATABASE_URL_POOLED",
  "CONCORD_PROGRAM_ID",
  "MAGICBLOCK_BASE_RPC_URL",
  "MAGICBLOCK_ER_RPC_URL",
  "MAGICBLOCK_PER_RPC_URL",
  "MAGICBLOCK_VRF_QUEUE",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CRON_SECRET",
] as const;

export const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_SOLANA_CLUSTER",
  "NEXT_PUBLIC_SOLANA_RPC_URL",
] as const;

function pick(source: EnvSource, keys: readonly string[]): EnvSource {
  const out: EnvSource = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== "") {
      out[key] = value;
    }
  }
  return out;
}

export function parseServerEnv(source: EnvSource): ServerEnv {
  return serverEnvSchema.parse(pick(source, SERVER_ENV_KEYS));
}

export function parsePublicEnv(source: EnvSource): PublicEnv {
  return publicEnvSchema.parse(pick(source, PUBLIC_ENV_KEYS));
}
