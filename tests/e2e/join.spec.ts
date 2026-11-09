/** Invitation and admission rules through the real UI (spec 17.1 #5-#8, 17.3). */
import { expect, test } from "@playwright/test";
import { apiCall, createDraft, issueInvite, newActor, seed, signIn } from "./fixtures/flows";

test("join code works; wrong code rejected; rotation kills old credentials; rejected cannot re-request", async ({ browser }) => {
  const host = await newActor(browser, "host");
  await signIn(host.page);
  const meetingId = await createDraft(host, "Join rules");
  await seed(host, meetingId, "WAITING_ROOM");
  const first = await issueInvite(host, meetingId);

  const a = await newActor(browser, "a");
  await signIn(a.page);
  await a.page.goto(`/join/${meetingId}`);
  await a.page.getByTestId("display-name").fill("Alice");
  await a.page.getByTestId("join-code-input").fill("WRONGCOD");
  await a.page.getByTestId("request-entry").click();
  await expect(a.page.getByTestId("error")).toContainText(/invalid|replaced/i);
  await a.page.getByTestId("join-code-input").fill(first.joinCode);
  await a.page.getByTestId("request-entry").click();
  await expect(a.page.getByTestId("join-pending")).toBeVisible();

  // Rotation: the old code stops working for new people.
  const rotated = await apiCall<{ joinCode: string }>(host, `/meetings/${meetingId}/invitation/rotate`, {});
  const b = await newActor(browser, "b");
  await signIn(b.page);
  const old = await apiCall(b, `/meetings/${meetingId}/join-requests`, { joinCode: first.joinCode, displayName: "Bob" });
  expect(old.status).toBe(403);
  const fresh = await apiCall(b, `/meetings/${meetingId}/join-requests`, { joinCode: rotated.json.joinCode, displayName: "Bob" });
  expect(fresh.status).toBe(201);

  // Host rejects Alice in the lobby; Alice sees it and cannot request again.
  await host.page.goto(`/meeting/${meetingId}/lobby`);
  await expect(host.page.getByTestId("pending-request")).toHaveCount(2);
  await host.page.getByTestId("pending-request").filter({ hasText: "Alice" }).getByTestId("reject").click();
  await expect(a.page.getByTestId("join-rejected")).toBeVisible({ timeout: 15_000 });
  const again = await apiCall(a, `/meetings/${meetingId}/join-requests`, { joinCode: rotated.json.joinCode, displayName: "Alice" });
  expect(again.status).toBe(403);

  // Unadmitted wallets learn nothing about the meeting.
  const view = await apiCall(b, `/meetings/${meetingId}`);
  expect(view.json.role).toBe("pending");
  expect(JSON.stringify(view.json)).not.toMatch(/inviteSecretHash|inviteCodeHash|description/);
});
