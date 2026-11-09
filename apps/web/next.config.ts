import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solana/MagicBlock SDKs mix ESM and CJS builds; let Node load them natively on the server.
  serverExternalPackages: ["ws", "@electric-sql/pglite", "@neondatabase/serverless", "@solana/web3.js", "@coral-xyz/anchor", "@magicblock-labs/ephemeral-rollups-sdk"],
  transpilePackages: ["@concord/shared-types", "@concord/client", "@concord/receipt-hash"],
  // @solana/kit-plugin-payer's browser bundle has a spurious `import 'fs'`
  // from the payerFromFile export. Stub it out for the client bundle.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./empty-module.js" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    }
    return config;
  },
};

export default nextConfig;
