# Cost Report (Devnet, measured)

Source: `pnpm test:devnet` (`tests/devnet/gates.ts`), run 2026-11-09 against program
`85DsSom7cr5hHVZeTB7k3WKKKpFMB2DLUN3c6FbR9861` and the TEE PER
`devnet-tee-as.magicblock.app`. The full log is in `tests/devnet/out/gates-report.json`.

Scenario: one meeting, **20 participants with voter slots**, 19 eligible, one vote
round, 17 ballots cast, 1 observer, then the full teardown (end, close slots,
undelegate, receipt, close).

| Who | Cost |
|---|---|
| **Each voter / observer** | **0 SOL.** All 20 wallets were created with 0 lamports and still had 0 at the end. They signed every PER transaction and paid its fee themselves: cast, finalize, commit. |
| **Host, peak SOL locked during the meeting** | **0.0381 SOL**: registry, session and results rent, permission and delegation records, the 0.001 SOL slot-sponsor budget, and the VRF request |
| **Host, net cost after teardown** | **0.0143 SOL per meeting** |
| Kept permanently | Public receipt registry: 0.00156 SOL rent, so the receipt stays verifiable |

The net 0.0143 SOL breaks down as: the registry kept as the public receipt
(0.00156), base-layer signature fees for about 10 host transactions, the VRF request
fee, and delegation-program fees. Ephemeral voter slots cost about 8.4k lamports
each while open and are fully refunded on close.

Per extra vote round the host pays **nothing**: every vote-round instruction runs
on the PER and is fee-free, and commits fall under MagicBlock's default
sponsorship (up to 8 rounds per meeting are allowed).

## How to re-measure

```bash
pnpm test:devnet              # 20 voters by default; N_VOTERS=4 for a quick run
pnpm exec tsx tests/devnet/recover.ts <meetingId>   # reclaim rent from an aborted run
```
