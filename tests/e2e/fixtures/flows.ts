import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";
import { installTestWallet } from "./test-wallet";

export const BASE_URL = "http://localhost:3100";
export const E2E_SEED_SECRET = "e2e-seed-secret-0123456789abcdef0123456789";

export interface Actor {
  kp: Keypair;
  ctx: BrowserContext;
  page: Page;
}

/** A fresh, isolated browser profile with its own injected wallet (0 SOL unless funded). */
export async function newActor(browser: Browser, label: string, kp = Keypair.generate()): Promise<Actor> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${label}] ${m.text().slice(0, 300)}`);
  });
  await installTestWallet(page, kp);
  return { kp, ctx, page };
}

export async function signIn(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
}

/** Same-origin JSON API call using the actor's session cookie. */
export async function apiCall<T = any>(a: Actor, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await a.ctx.request.fetch(`${BASE_URL}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: BASE_URL, "content-type": "application/json", ...extraHeaders },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status(), json: json as T };
}

export async function createDraft(host: Actor, name = "E2E meeting") {
  const r = await apiCall<{ meetingId: string }>(host, "/meetings/drafts", {
    name,
    scheduledStartAt: new Date(Date.now() + 60_000).toISOString(),
  });
  expect(r.status).toBe(201);
  return r.json.meetingId;
}

export async function seed(host: Actor, meetingId: string, status: "WAITING_ROOM" | "LIVE" | "ENDED", startedSecondsAgo?: number) {
  const r = await apiCall(host, "/test/seed", { meetingId, status, startedSecondsAgo }, { "x-e2e-seed": E2E_SEED_SECRET });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

export async function issueInvite(host: Actor, meetingId: string) {
  const r = await apiCall<{ inviteUrl: string; joinCode: string }>(host, `/meetings/${meetingId}/invitation`, {});
  expect(r.status).toBe(200);
  return r.json;
}

/** Number of <video> elements on the page that are decoding live frames. */
export async function playingVideos(page: Page) {
  return page.evaluate(async () => {
    const vids = Array.from(document.querySelectorAll("video"));
    const t0 = vids.map((v) => v.currentTime);
    await new Promise((r) => setTimeout(r, 1500));
    return vids.filter((v, i) => v.videoWidth > 0 && v.readyState >= 2 && v.currentTime > t0[i]).length;
  });
}
