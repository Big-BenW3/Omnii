/**
 * Full product loop in two real browsers (spec 17.4), against Devnet + the
 * MagicBlock TEE PER + LiveKit:
 *   host creates (real VRF) -> invite -> guest requests -> host admits ->
 *   both join the call and SEE EACH OTHER -> private vote -> on-chain tally ->
 *   end -> receipt published -> public page verifies.
 * Only the host wallet is funded; the guest wallet must stay at 0 SOL.
 *
 * Run headed to watch both windows:  pnpm e2e --headed
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Connection, Keypair } from "@solana/web3.js";
import { installTestWallet } from "./fixtures/test-wallet";
import { loadE2EHost } from "./global-setup";

const conn = new Connection(process.env.BASE_RPC ?? "https://rpc.magicblock.app/devnet", "confirmed");

async function openAs(context: BrowserContext, kp: Keypair, label: string): Promise<Page> {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${label} console] ${m.text().slice(0, 300)}`);
  });
  await installTestWallet(page, kp);
  return page;
}

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
}

/** Every tile video is decoding real frames (dimensions known, time advancing). */
async function playingVideos(page: Page) {
  return page.evaluate(async () => {
    const vids = Array.from(document.querySelectorAll("video"));
    const t0 = vids.map((v) => v.currentTime);
    await new Promise((r) => setTimeout(r, 1500));
    return vids.filter((v, i) => v.videoWidth > 0 && v.readyState >= 2 && v.currentTime > t0[i]).length;
  });
}

test("host and guest: invite, admit, live call, private vote, receipt, verify", async ({ browser }) => {
  const hostKp = loadE2EHost();
  const guestKp = Keypair.generate(); // 0 SOL for the whole test
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await openAs(hostCtx, hostKp, "host");
  const guest = await openAs(guestCtx, guestKp, "guest");

  await test.step("host signs in and creates a meeting (VRF + private rollup setup)", async () => {
    await signIn(host);
    await host.goto("/create");
    await host.getByTestId("meeting-name").fill("E2E roadmap sync");
    await host.getByTestId("create-submit").click();
    await expect(host).toHaveURL(/\/meeting\/[0-9a-f-]+\/setup/);
    await host.getByTestId("step1").click();
    await expect(host.getByTestId("step1-done")).toBeVisible({ timeout: 120_000 });
    await host.getByTestId("step2").click();
    await expect(host.getByTestId("step2-done")).toBeVisible({ timeout: 300_000 });
    await expect(host.getByTestId("meeting-status")).toHaveText("WAITING_ROOM", { timeout: 60_000 });
    await host.getByTestId("step3").click();
  });

  const inviteUrl = (await host.getByTestId("invite-url").textContent())!.trim();
  const meetingId = inviteUrl.match(/join\/([0-9a-f-]+)/)![1];

  await test.step("guest opens the invite link, signs in, requests entry", async () => {
    await signIn(guest);
    await guest.goto(inviteUrl);
    await expect(guest.getByTestId("has-invite-link")).toBeVisible();
    expect(guest.url()).not.toContain("#s="); // secret removed from the address bar
    await guest.getByTestId("display-name").fill("Guest Voter");
    await guest.getByTestId("request-entry").click();
    await expect(guest.getByTestId("join-pending")).toBeVisible();
  });

  await test.step("host admits, marks voter, prepares slots, starts the meeting", async () => {
    await host.goto(`/meeting/${meetingId}/lobby`);
    await expect(host.getByTestId("pending-request")).toHaveCount(1);
    await host.getByTestId("admit").click();
    await expect(host.getByTestId("admitted-participant")).toHaveCount(1);
    await host.getByTestId("voter-toggle").check();
    await expect(host.getByTestId("voter-toggle")).toBeChecked();
    await host.getByTestId("prepare-slots").click();
    await expect(host.getByTestId("slots-ready")).toHaveText(/2 slots ready/, { timeout: 120_000 });
    await host.getByTestId("start-meeting").click();
    await expect(host.getByTestId("meeting-status")).toHaveText("LIVE", { timeout: 120_000 });
  });

  await test.step("both enter the call and see each other's live video", async () => {
    await expect(guest.getByTestId("join-admitted")).toBeVisible();
    await guest.goto(`/meeting/${meetingId}/lobby`);
    await guest.getByTestId("enter-room").click();
    await host.goto(`/meeting/${meetingId}`);
    for (const p of [host, guest]) {
      await expect.poll(() => playingVideos(p), { timeout: 90_000, intervals: [2_000] }).toBeGreaterThanOrEqual(2);
    }
    await expect(host.locator(".lk-participant-name", { hasText: "Guest Voter" })).toBeVisible();
    await expect(guest.locator(".lk-participant-name", { hasText: "Host" })).toBeVisible();
  });

  await test.step("host opens a vote; guest and host vote privately; no counts before finalize", async () => {
    await host.getByTestId("vote-question").fill("Which project should we fund?");
    await host.getByTestId("vote-option-input-0").fill("Garden");
    await host.getByTestId("vote-option-input-1").fill("Library");
    await host.getByTestId("vote-option-input-2").fill("Abstain");
    await host.getByTestId("open-vote").click();
    await expect(guest.getByTestId("active-vote")).toBeVisible({ timeout: 60_000 });
    await expect(guest.getByTestId("results")).toHaveCount(0);
    await guest.getByTestId("vote-option-1").click();
    await expect(guest.getByTestId("vote-submitted")).toBeVisible({ timeout: 60_000 });
    await host.getByTestId("vote-option-1").click();
    await expect(host.getByTestId("vote-submitted")).toBeVisible({ timeout: 60_000 });
    await expect(host.getByTestId("results")).toHaveCount(0);
  });

  await test.step("host finalizes; both see the on-chain aggregate", async () => {
    await host.getByTestId("finalize-vote").click();
    for (const p of [host, guest]) {
      await expect(p.getByTestId("result-0-option-1")).toHaveText("Library: 2", { timeout: 120_000 });
      await expect(p.getByTestId("result-0-option-0")).toHaveText("Garden: 0");
    }
  });

  await test.step("host ends the meeting, publishes the receipt", async () => {
    await host.getByTestId("end-meeting").click();
    await expect(host).toHaveURL(/\/receipt$/, { timeout: 180_000 });
    await host.getByTestId("undelegate").click();
    await expect(host.getByTestId("room-on-base")).toBeVisible({ timeout: 240_000 });
    await host.getByTestId("confirm-disclosure").check();
    await host.getByTestId("publish-receipt").click();
    await expect(host.getByTestId("receipt-published")).toBeVisible({ timeout: 240_000 });
  });

  await test.step("anyone can verify the public receipt", async () => {
    const href = await host.getByTestId("public-receipt-link").getAttribute("href");
    const viewer = await (await browser.newContext()).newPage();
    await viewer.goto(href!);
    await viewer.getByTestId("verify").click();
    await expect(viewer.getByTestId("verdict")).toHaveText("Verified", { timeout: 60_000 });
    await expect(viewer.getByTestId("receipt-vote-0")).toContainText("Library: 2");
    // No private data on the public page.
    const text = await viewer.locator("body").innerText();
    expect(text).not.toContain("E2E roadmap sync");
    expect(text).not.toContain("Guest Voter");
    expect(text).not.toContain(guestKp.publicKey.toBase58());
  });

  await test.step("the guest never needed SOL", async () => {
    expect(await conn.getBalance(guestKp.publicKey)).toBe(0);
  });
});
