# Concord Status

**Last updated:** 2026-11-09
**Plan:** [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md)
**Decisions:** [architecture/decisions.md](architecture/decisions.md) (ADR-011 to ADR-016 drive the current work)

Earlier status documents overstated completion. They are kept in [archive/](archive/) for history only.

## Verified working

- The Rust and TypeScript receipt digests are byte-identical (`pnpm test:digest`).
- 31 Rust unit tests pass. They cover logic only, not instructions.
- The web app typechecks.
- The devnet env guard passes.

## Remaining gaps

| Area | State |
|---|---|
| Frontend | Old pages still in place: the home page never signs in, there's no join, lobby, live room vote panel, receipt review, public verify page or dashboard, and the voting UI is still mocked. Phase 5 replaces all of it. |
| `next build` | Not yet verified after the API rewrite; it may need `transpilePackages` for the workspace packages. |
| E2E | Playwright suites, including the two-browser call, are not written yet (Phase 6). |
| Trust notes | The meeting start and end time in the DB (which only gate media tokens) is host-reported; vote timing is enforced by the program clock. Action-item owner text becomes public in the receipt. |

## Phase progress

| Phase | State |
|---|---|
| 0 Housekeeping | done |
| 1 Devnet fee/PER spike | done: 0-SOL voters and ephemeral slot isolation confirmed (see architecture/magicblock-proof.md) |
| 2 Program rewrite + LiteSVM | done: new program deployed; 13 Rust unit + 17 LiteSVM instruction tests pass |
| 3 Devnet gates + cost report | done: Gates A-F 64/64 on Devnet TEE with 20 voters; voters 0 SOL; host net 0.0143 SOL/meeting (architecture/cost-report.md) |
| 4 Backend foundation + Vitest | done: all spec 10.x routes + chain-sync, lifecycle, vote-rounds, participants, public receipts; 49 API tests pass |
| 5 All screens and flows | not started |
| 6 Playwright (incl. two-browser call) + CI | not started |
| 7 Ops and release | not started |
