import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as seed } from "@/api/v1/test/seed/route";
import { POST as createDraft } from "@/api/v1/meetings/drafts/route";
import { freshDb, req, signIn, TestWallet } from "../support/harness";

const SECRET = "e2e-seed-secret-0123456789abcdef0123456789";

describe("test-only seed route", () => {
  let cookie: string;
  let meetingId: string;
  beforeEach(async () => {
    await freshDb();
    cookie = await signIn(new TestWallet());
    const r = await createDraft(
      req("POST", "/x", { cookie, body: { name: "Seeded", scheduledStartAt: new Date(Date.now() + 60_000).toISOString() } })
    );
    meetingId = (await r.json()).meetingId;
  });
  afterEach(() => {
    delete process.env.CONCORD_E2E_SEED_SECRET;
    delete process.env.VERCEL_ENV;
  });

  const call = (headers: Record<string, string> = {}, c = cookie) =>
    seed(req("POST", "/api/v1/test/seed", { cookie: c, headers, body: { meetingId, status: "LIVE" } }));

  it("does not exist unless the E2E secret is configured", async () => {
    expect((await call({ "x-e2e-seed": SECRET })).status).toBe(404);
  });

  it("does not exist on a Vercel production deploy even with the secret", async () => {
    process.env.CONCORD_E2E_SEED_SECRET = SECRET;
    process.env.VERCEL_ENV = "production";
    expect((await call({ "x-e2e-seed": SECRET })).status).toBe(404);
  });

  it("requires the matching secret header and the meeting host", async () => {
    process.env.CONCORD_E2E_SEED_SECRET = SECRET;
    expect((await call({ "x-e2e-seed": "wrong" })).status).toBe(404);
    const other = await signIn(new TestWallet());
    expect((await call({ "x-e2e-seed": SECRET }, other)).status).toBe(403);
    expect((await call({ "x-e2e-seed": SECRET })).status).toBe(200);
  });
});
