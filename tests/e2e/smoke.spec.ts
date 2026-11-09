/** Every screen renders; wallet gate and session rules hold (spec 17.1 #1-#2, 17.3). */
import { expect, test } from "@playwright/test";
import { BASE_URL, apiCall, newActor, signIn } from "./fixtures/flows";

const PUBLIC_ROUTES = ["/", "/privacy", "/create", "/dashboard", "/join/00000000-0000-4000-8000-000000000000"];

for (const route of PUBLIC_ROUTES) {
  test(`renders ${route} without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("gated pages ask for a wallet and then for a free sign-in", async ({ browser, page }) => {
  await page.goto("/create");
  await expect(page.getByTestId("needs-sign-in")).toContainText(/Connect a Solana wallet/);
  const a = await newActor(browser, "a");
  await a.page.goto("/create");
  await expect(a.page.getByTestId("needs-sign-in")).toContainText(/Sign in/);
  await signIn(a.page);
  await a.page.goto("/create");
  await expect(a.page.getByTestId("meeting-name")).toBeVisible();
});

test("session cookie is HttpOnly + SameSite=Strict; sign-out revokes it", async ({ browser }) => {
  const a = await newActor(browser, "a");
  await signIn(a.page);
  const cookie = (await a.ctx.cookies()).find((c) => c.name === "concord_session")!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  expect((await apiCall(a, "/auth/check")).json.isAuthenticated).toBe(true);
  await a.page.getByRole("button", { name: "Sign out" }).click();
  await expect(a.page.getByTestId("signed-in-as")).toHaveCount(0);
  expect((await apiCall(a, "/auth/check")).json.isAuthenticated).toBe(false);
});

test("a forged x-wallet-address header grants nothing; cross-origin mutations are refused", async ({ request }) => {
  const forged = await request.get(`${BASE_URL}/api/v1/meetings`, { headers: { "x-wallet-address": "11111111111111111111111111111111" } });
  expect(forged.status()).toBe(401);
  const csrf = await request.post(`${BASE_URL}/api/v1/meetings/drafts`, {
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    data: "{}",
  });
  expect(csrf.status()).toBe(403);
});

test("public receipt for an unknown room is not reported as verified", async ({ page }) => {
  await page.goto("/receipt/11111111111111111111111111111111");
  await expect(page.getByTestId("verdict")).not.toHaveText("Verified");
});

test("the seed route needs the E2E secret", async ({ browser }) => {
  const a = await newActor(browser, "a");
  await signIn(a.page);
  const r = await apiCall(a, "/test/seed", { meetingId: "00000000-0000-4000-8000-000000000000", status: "LIVE" });
  expect(r.status).toBe(404);
});
