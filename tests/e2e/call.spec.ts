/**
 * Two browsers join the same LiveKit call through the real invite -> request ->
 * admit flow, and each sees and hears the other (spec 17.1 #7, #9; plan 6.3 #4).
 * Chain setup is skipped by seeding the meeting LIVE; media is LiveKit for real.
 *
 * Watch it: pnpm e2e:call --headed
 */
import { expect, test } from "@playwright/test";
import { apiCall, createDraft, issueInvite, newActor, playingVideos, seed, signIn } from "./fixtures/flows";

test("two browsers: invite, admit, see and hear each other, mute, leave, rejoin", async ({ browser }) => {
  const host = await newActor(browser, "host");
  const guest = await newActor(browser, "guest");
  await signIn(host.page);
  await signIn(guest.page);

  const meetingId = await createDraft(host, "Call test");
  await seed(host, meetingId, "WAITING_ROOM");
  const { inviteUrl } = await issueInvite(host, meetingId);

  await test.step("guest requests entry with the invite link; host admits in the lobby", async () => {
    await guest.page.goto(inviteUrl);
    await guest.page.getByTestId("display-name").fill("Guest Ada");
    await guest.page.getByTestId("request-entry").click();
    await expect(guest.page.getByTestId("join-pending")).toBeVisible();
    await host.page.goto(`/meeting/${meetingId}/lobby`);
    await host.page.getByTestId("admit").click();
    await expect(guest.page.getByTestId("join-admitted")).toBeVisible({ timeout: 15_000 });
  });

  await test.step("an unadmitted wallet cannot get a media token", async () => {
    const stranger = await newActor(browser, "stranger");
    await signIn(stranger.page);
    await seed(host, meetingId, "LIVE");
    const r = await apiCall(stranger, `/meetings/${meetingId}/livekit-token`, {});
    expect(r.status).toBe(403);
    await stranger.ctx.close();
  });

  await test.step("both join and see each other's live video", async () => {
    await host.page.goto(`/meeting/${meetingId}`);
    await guest.page.goto(`/meeting/${meetingId}`);
    for (const p of [host.page, guest.page]) {
      await expect.poll(() => playingVideos(p), { timeout: 60_000, intervals: [2_000] }).toBeGreaterThanOrEqual(2);
    }
    await expect(host.page.locator(".lk-participant-name", { hasText: "Guest Ada" })).toBeVisible();
    await expect(guest.page.locator(".lk-participant-name", { hasText: "Host" })).toBeVisible();
  });

  await test.step("each hears the other (remote audio track subscribed)", async () => {
    for (const p of [host.page, guest.page]) {
      await expect
        .poll(() => p.evaluate(() => Array.from(document.querySelectorAll("audio")).filter((a) => !a.paused && a.srcObject).length), {
          timeout: 30_000,
        })
        .toBeGreaterThanOrEqual(1);
    }
  });

  await test.step("guest turns the camera off; host sees it; back on", async () => {
    const guestTileOnHost = host.page.locator(".lk-participant-tile", { hasText: "Guest Ada" });
    await guest.page.locator('button[data-lk-source="camera"]').click();
    await expect(guestTileOnHost).toHaveAttribute("data-lk-video-muted", "true", { timeout: 15_000 });
    await guest.page.locator('button[data-lk-source="camera"]').click();
    await expect(guestTileOnHost).toHaveAttribute("data-lk-video-muted", "false", { timeout: 15_000 });
  });

  await test.step("guest leaves; host sees only themselves; guest rejoins", async () => {
    await guest.page.locator(".lk-disconnect-button").click();
    await expect(host.page.locator(".lk-participant-tile")).toHaveCount(1, { timeout: 20_000 });
    await guest.page.getByTestId("rejoin").click();
    await expect(host.page.locator(".lk-participant-tile")).toHaveCount(2, { timeout: 30_000 });
    await expect.poll(() => playingVideos(host.page), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  });
});

test("media tokens stop after the 60-minute limit", async ({ browser }) => {
  const host = await newActor(browser, "host");
  await signIn(host.page);
  const meetingId = await createDraft(host, "Expiry test");
  await seed(host, meetingId, "LIVE", 3601);
  const r = await apiCall(host, `/meetings/${meetingId}/livekit-token`, {});
  expect(r.status).toBe(409);
});
