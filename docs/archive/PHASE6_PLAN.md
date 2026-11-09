# Concord Project - Phase 6 Plan (Testing, Validation & Production)

**Last Updated:** November 8, 2026  
**Project:** Concord - Private Meetings on Solana  
**Status:** Phase 5 complete, Phase 6 ready to begin  
**Program deployed:** `85DsSom7cr5hHVZeTB7k3WKKKpFMB2DLUN3c6FbR9861` (Devnet)

---

## Executive Summary

Phases 1-5 are complete. The Solana program builds and is deployed to Devnet. All 17 API endpoints are implemented. The Next.js web app builds successfully (18 routes generated). PostgreSQL schema is created in Neon. LiveKit and VRF credentials are configured.

Phase 6 focuses on **testing, privacy gate validation, mobile optimization, and production readiness**. The critical path is proving Gates C, D, E on MagicBlock Devnet PER — without these, private voting cannot ethically be claimed.

---

## Phase Status Overview

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Solana Program Logic | ✅ Complete | 100% |
| Phase 2: API Endpoints | ✅ Complete | 100% |
| Phase 3: Web Application | ✅ Complete | 100% |
| Phase 4: Build Verification | ✅ Complete | 100% |
| Phase 5: Infrastructure & Deployment | ✅ Complete | 100% |
| **Phase 6: Testing & Production** | ⏳ READY | 0% |

**Overall Completion: ~85-90%**

---

## Phase 6 Deliverables

### 6.1 Testing Suite (High Priority)

#### 6.1.1 API Endpoint Tests
Create unit/integration tests for all 17 API endpoints.

| Endpoint | Test Cases |
|----------|-----------|
| `POST /api/v1/auth/nonce` | Valid nonce generation, invalid wallet, missing params, rate limiting |
| `POST /api/v1/auth/verify` | Valid signature, invalid signature, expired nonce, replay prevention |
| `POST /api/v1/auth/logout` | Session invalidation, cookie clearing |
| `GET /api/v1/auth/check` | Authenticated session, unauthenticated request, expired session |
| `POST /api/v1/meetings/drafts` | Create meeting, validation errors, creator wallet required |
| `GET /api/v1/meetings/:meetingId` | Get meeting, meeting not found |
| `POST /api/v1/meetings/:meetingId/lifecycle` | Creator only, valid transitions |
| `POST /api/v1/meetings/:meetingId/invite-rotate` | Creator only, version bump |
| `POST /api/v1/meetings/:meetingId/vrf` | VRF request |
| `POST /api/v1/meetings/:meetingId/room-registry` | Room registry |
| `POST /api/v1/meetings/join-requests` | Create request, duplicate prevention |
| `GET /api/v1/meetings/join-requests` | List requests |
| `POST /api/v1/meetings/:meetingId/join-requests/:requestId/decision` | Approve/reject, creator only |
| `POST /api/v1/meetings/receipts/draft` | Create draft |
| `GET /api/v1/meetings/receipts` | List receipts, pagination |
| `POST /api/v1/livekit/token` | Token generation |
| `POST /api/v1/livekit/webhook` | Idempotency, event handling |

**Files to create:**
- `tests/api/auth.test.ts`
- `tests/api/meetings.test.ts`
- `tests/api/join-requests.test.ts`
- `tests/api/receipts.test.ts`
- `tests/api/livekit.test.ts`

#### 6.1.2 Component Tests (React Testing Library)
- `tests/components/wallet/connect-button.test.tsx`
- `tests/components/wallet/address-display.test.tsx`
- `tests/components/livekit/meeting-room.test.tsx`
- `tests/components/voting/create-vote-modal.test.tsx`
- `tests/components/voting/vote-card.test.tsx`
- `tests/components/voting/receipt-card.test.tsx`

#### 6.1.3 E2E Tests (Playwright)
- `tests/e2e/auth-flow.spec.ts` — Connect wallet → nonce → verify → session
- `tests/e2e/meeting-flow.spec.ts` — Create meeting → join request → approve → join room
- `tests/e2e/voting-flow.spec.ts` — Create vote → cast vote → view results → receipt
- `tests/e2e/livekit-flow.spec.ts` — Join room → media controls → leave

**Files to create:**
- `tests/playwright.config.ts`
- `tests/e2e/*.spec.ts`

#### 6.1.4 Test Infrastructure
- Add vitest/jest as test runner
- Configure test database (separate Neon branch or local)
- Add test fixtures and mock data
- CI pipeline integration

**Estimated effort:** 2-4 hours

---

### 6.2 PER Privacy Gate Validation (Critical - External Dependency)

**Blocker:** MagicBlock Devnet PER access required. Cannot prove private voting without this.

#### 6.2.1 Gate A: Version and Routing Verification
- [ ] Confirm ephemeral-rollups-sdk 0.17.3 compatibility with Anchor 1.1.2
- [ ] Verify Devnet ER/PER RPC endpoints
- [ ] Confirm PER authentication requirements
- [ ] Document PER configuration used

#### 6.2.2 Gate B: VRF Lifecycle Proof
- [ ] Test VRF request with documented queue (`Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh`)
- [ ] Verify callback updates room state
- [ ] Test refresh/resume after browser restart
- [ ] Verify duplicate request prevention

#### 6.2.3 Gate C: Private Ballot Isolation (CRITICAL)
- [ ] Verify PrivateBallot accounts created in PER
- [ ] Prove Voter B CANNOT query Voter A's ballot via RPC
- [ ] Prove Voter B CANNOT query Voter A's ballot via program
- [ ] Inspect transaction logs for ballot data leakage
- [ ] Verify PER query filtering blocks unauthorized access

#### 6.2.4 Gate D: Tally Completeness (CRITICAL)
- [ ] Implement ballot reading from PER in `finalize_vote`
- [ ] Verify all ballot PDAs must be provided
- [ ] Verify no ballot substitution possible
- [ ] Verify no ballot omission possible
- [ ] Test with 20 eligible voters
- [ ] Verify compute limits and account-meta constraints

#### 6.2.5 Gate E: No Premature Public Result (CRITICAL)
- [ ] Verify PublicVoteSummary not readable during Open state
- [ ] Verify PublicVoteSummary not readable during Closing state
- [ ] Verify PublicVoteSummary readable after Finalize (PER only)
- [ ] Verify PublicVoteSummary readable after Commit (base layer)
- [ ] Verify committed account contains only aggregate data

**Files:**
- `programs/concord/tests/per_privacy_tests.rs` — Test program (exists, needs Devnet)
- `docs/architecture/magicblock-proof.md` — Update with test results

**Estimated effort:** 2-3 days (requires MagicBlock PER access — external, 1-2 days)

---

### 6.3 Mobile Optimization (Medium Priority)

| Task | Detail | Effort |
|------|--------|--------|
| Seeker device testing | Test wallet connection on Seeker Android devices | 2-4 hours |
| Mobile wallet integration | Verify @solana/wallet-adapter-react works with mobile wallets | 2-4 hours |
| Responsive UI audit | Check all pages on mobile breakpoints | 1-2 hours |
| Touch-friendly controls | Ensure buttons/targets are >= 44px | 1 hour |

**Files to check:**
- `apps/web/components/wallet/connect-button.tsx`
- `apps/web/components/wallet/address-display.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/meetings/new/page.tsx`
- `apps/web/app/meetings/[meetingId]/room/page.tsx`

**Estimated effort:** 2-4 hours

---

### 6.4 Production Deployment (Medium Priority)

| Task | Detail | Effort |
|------|--------|--------|
| Production database | Provision production PostgreSQL (Neon production tier) | 1 hour |
| Environment configuration | Production `.env` with real secrets | 1 hour |
| CI/CD pipeline | GitHub Actions for build, test, deploy | 2-4 hours |
| Monitoring | Error tracking, performance monitoring | 2-4 hours |
| Production deployment | Deploy Next.js app to Vercel/equivalent | 1-2 hours |
| Mainnet program deploy | Deploy Solana program to mainnet (after gates pass) | 1 hour |

**Estimated effort:** 1-2 weeks

---

## Phase 6 Exit Gates

| Exit Gate | Status | Criteria |
|-----------|--------|----------|
| Testing suite passes | ⬜ | All API, component, and E2E tests pass |
| Privacy gates proven | ⬜ | Gates C, D, E pass on Devnet PER |
| Mobile tested | ⬜ | Seeker device testing complete |
| Production ready | ⬜ | CI/CD, monitoring, deployment verified |
| No mainnet claims | ⬜ | No "private voting" claims until gates pass |

---

## Risk Assessment

### High Risk (BLOCKING)

1. **MagicBlock PER Access** — Cannot prove Gates C, D, E without Devnet PER deployment
   - *Impact:* Cannot claim private voting works
   - *Mitigation:* Contact MagicBlock team for Devnet PER access (external, 1-2 days)

2. **Privacy gates fail** — If PER doesn't support read restrictions, private voting is impossible
   - *Impact:* Core value proposition invalidated
   - *Mitigation:* Redesign using client-side encryption with on-chain proofs

### Medium Risk

1. **GLIBCXX Version** — Anchor CLI fails on this system
   - *Impact:* Cannot generate IDL or run anchor tests
   - *Mitigation:* Use cargo build directly (already working)

2. **Neon Serverless Cold Starts** — Database connections time out on first request
   - *Impact:* Slow auth responses (~10-30s on cold start)
   - *Mitigation:* Pool configuration added; consider always-on production tier

3. **VRF Queue Compatibility** — VRF might not work with callback handler
   - *Impact:* Randomness features may not work
   - *Mitigation:* Test against actual Devnet queue

### Low Risk

1. **Mobile wallet quirks** — Seeker devices may have specific issues
2. **Testing coverage** — Can be added incrementally
3. **UI polish** — Cosmetic improvements, non-blocking

---

## Implementation Priority

### Phase 6A: Testing Suite (High Priority)
1. Set up test runner (vitest/jest)
2. Write API endpoint unit tests
3. Write component tests
4. Write Playwright E2E tests
5. Integrate into CI pipeline

### Phase 6B: Privacy Gate Validation (Critical - External)
1. Contact MagicBlock for Devnet PER access
2. Deploy program to Devnet (already done)
3. Run Gate C, D, E tests
4. Document results in `docs/architecture/magicblock-proof.md`

### Phase 6C: Mobile Optimization (Medium Priority)
1. Test on Seeker devices
2. Fix mobile wallet integration
3. Responsive UI audit

### Phase 6D: Production Deployment (Medium Priority)
1. Production database setup
2. CI/CD pipeline
3. Monitoring and error tracking
4. Deploy to production

---

## Estimated Timeline

| Milestone | Duration | Priority | Dependencies |
|-----------|----------|----------|--------------|
| 6A: Testing Suite | 2-4 hours | High | Phase 5 complete |
| 6B: PER Gate Validation | 2-3 days | Critical | MagicBlock PER access |
| 6C: Mobile Optimization | 2-4 hours | Medium | Phase 5 complete |
| 6D: Production Deploy | 1-2 weeks | Medium | Gates C, D, E proven |

**Total Internal:** ~1 day  
**Total External:** 1-2 days (MagicBlock PER access)  
**Overall:** 2-3 days to testing complete; 1-2 weeks to production

---

## Files to Create

### Testing
- `tests/api/auth.test.ts`
- `tests/api/meetings.test.ts`
- `tests/api/join-requests.test.ts`
- `tests/api/receipts.test.ts`
- `tests/api/livekit.test.ts`
- `tests/components/wallet/connect-button.test.tsx`
- `tests/components/wallet/address-display.test.tsx`
- `tests/components/livekit/meeting-room.test.tsx`
- `tests/components/voting/create-vote-modal.test.tsx`
- `tests/components/voting/vote-card.test.tsx`
- `tests/components/voting/receipt-card.test.tsx`
- `tests/playwright.config.ts`
- `tests/e2e/auth-flow.spec.ts`
- `tests/e2e/meeting-flow.spec.ts`
- `tests/e2e/voting-flow.spec.ts`
- `tests/e2e/livekit-flow.spec.ts`

### Documentation Updates
- `docs/architecture/magicblock-proof.md` — Update with Gate C/D/E test results
- `docs/PROJECT_STATUS.md` — Mark Phase 6 in progress
- `docs/SUMMARY.md` — Update completion percentages

---

## References

- `CONCORD_PRODUCT_SPEC.md` — Source of truth for product requirements
- `docs/architecture/decisions.md` — Architecture Decision Records (ADR-001 through ADR-010)
- `docs/architecture/magicblock-proof.md` — Privacy proof tracking (Gates A-F)
- `PHASE4_STATUS.md` — Phase 4 build verification details
- `FINAL_STATUS.md` — Complete project status across all phases
- `COMPLETION_PLAN.md` — Completion plan for all phases

---

## Success Criteria

Phase 6 is complete when:

1. ✅ All API endpoint tests pass
2. ✅ All component tests pass
3. ✅ All E2E Playwright tests pass
4. ✅ Gates C, D, E proven on Devnet PER (or documented as blocked)
5. ✅ Mobile wallet tested on Seeker devices
6. ✅ CI/CD pipeline configured
7. ✅ Production deployment verified
8. ✅ No "private voting" claims until Gates C, D, E pass

---

## Do NOT

- **Do NOT** ship or demo "private voting" until Gates C, D, E pass on Devnet PER
- **Do NOT** deploy to mainnet until privacy gates are proven
- **Do NOT** claim Gate F covers ballot privacy (Gate F is receipt verification only)
- **Do NOT** mix mainnet/testnet values in `.env.local` (enforced by `scripts/devnet-guard.mjs`)
