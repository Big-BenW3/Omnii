# Concord

Private video meetings, confidential voting, and verifiable decision records
on Solana. Source of truth for product scope and behavior:
`CONCORD_PRODUCT_SPEC.md`.

## Pinned toolchain (verified October 2026)

| Tool                                        | Version                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node.js                                     | 24.18.0                                                                                                                     |
| pnpm                                        | 10.33.0                                                                                                                     |
| Rust                                        | 1.89.0 (program builds; system default may be newer, see below)                                                             |
| Solana CLI                                  | 3.1.15                                                                                                                      |
| Anchor CLI                                  | 1.1.2 (`cargo install --git https://github.com/coral-xyz/anchor --tag v1.1.2 anchor-cli --locked`)                          |
| anchor-lang                                 | 1.1.2                                                                                                                       |
| ephemeral-rollups-sdk (Rust)                | 0.17.3, features `["anchor", "access-control"]`                                                                             |
| ephemeral-vrf-sdk (Rust)                    | 0.17.3, features `["anchor"]`                                                                                               |
| @magicblock-labs/ephemeral-rollups-kit (TS) | 0.17.3 (verify against @solana/kit v6 during the Phase 1 spike; fallback is the web3.js SDK package in one isolated module) |
| Next.js                                     | 16.3.4                                                                                                                      |
| React                                       | 19.2.3                                                                                                                      |
| @solana/kit                                 | 6.3.0                                                                                                                       |
| Tailwind CSS                                | 4                                                                                                                           |

Program IDs that must never be guessed (use the SDK constants
`ephemeral_rollups_sdk::consts` / `ephemeral_vrf_sdk::consts`):

| Program          | Address                                        |
| ---------------- | ---------------------------------------------- |
| Delegation       | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| Magic            | `Magic11111111111111111111111111111111111111`  |
| Magic Context    | `MagicContext1111111111111111111111111111111`  |
| Permission (PER) | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` |
| VRF              | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`  |

VRF queues (Devnet): base-layer `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh`,
delegated (ER) `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc`.

## Layout (spec section 12.5)

```text
MBP/
├── apps/
│   └── web/                 # Next.js app (App Router)
│       ├── app/             # routes, components, lib, API later
│       │   ├── components/landing/ # marketing sections
│       │   ├── components/wallet/  # wallet gate modal
│       │   ├── components/ui/      # shared primitives (pill buttons)
│       │   ├── lib/db/             # Drizzle schema + client (metadata only, no ballots table)
│       │   └── generated/concord/  # Codama client (regenerated from the program IDL)
│       └── .env.example     # copy to apps/web/.env.local
├── programs/
│   └── concord/             # Anchor program (placeholder vault logic until Phase 1 spike)
├── packages/
│   ├── shared-types/        # shared TS types + Zod schemas
│   └── receipt-hash/        # browser-verifiable receipt digest (spec section 16)
├── tests/                   # cross-package tests (digest vectors, etc.)
├── docs/architecture/       # ADRs, MagicBlock proof notes
├── CONCORD_PRODUCT_SPEC.md  # product source of truth
├── Anchor.toml              # Anchor workspace at the repo root
├── Cargo.toml               # Rust workspace (programs/*)
├── codama.json              # IDL -> apps/web/app/generated/concord
├── drizzle.config.ts
└── pnpm-workspace.yaml      # apps/*, packages/*
```

## Local setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in DATABASE_URL + secrets
pnpm dev                                       # http://localhost:3000
```

Database (hosted Postgres required, no local Docker here):

```bash
pnpm db:generate
pnpm db:migrate
```

Program (needs Anchor 1.1.2 CLI):

```bash
pnpm anchor-build
pnpm codama:js
pnpm anchor-test
```

## Build order (spec section 18)

1. Phase 1 spike: VRF fulfilment + PER privacy gate (spec section 9.6) on Devnet.
2. Phase 2: LiveKit media foundation.
3. Phase 3: meeting creation and onboarding.
4. Phase 4: voting and receipt.
5. Phase 5: hardening and presentation.

A mocked vote or mocked receipt is not a complete implementation.
