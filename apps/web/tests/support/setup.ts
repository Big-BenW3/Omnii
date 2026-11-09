// Deterministic test environment. These are test-only values, never real secrets.
Object.assign(process.env, {
  APP_BASE_URL: "http://localhost:3100",
  SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789",
  INVITE_HASH_SECRET: "test-invite-secret-0123456789abcdef01234567890",
  DATABASE_URL: "postgresql://unused-in-tests/pglite",
  CONCORD_PROGRAM_ID: "85DsSom7cr5hHVZeTB7k3WKKKpFMB2DLUN3c6FbR9861",
  MAGICBLOCK_BASE_RPC_URL: "https://api.devnet.solana.com",
  MAGICBLOCK_ER_RPC_URL: "https://devnet-router.magicblock.app",
  MAGICBLOCK_PER_RPC_URL: "https://devnet-tee-as.magicblock.app",
  MAGICBLOCK_VRF_QUEUE: "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
  LIVEKIT_URL: "ws://localhost:7880",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "secret-test-0123456789abcdef0123456789",
});
