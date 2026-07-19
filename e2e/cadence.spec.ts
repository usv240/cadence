import { expect, test } from "@playwright/test";

async function openFreshApp(page: import("@playwright/test").Page) {
  await page.goto("/app");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

async function skipOnboarding(page: import("@playwright/test").Page) {
  const start = page.getByRole("button", { name: "Start", exact: true });
  if (await start.isVisible()) await start.click();
  await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
}

test("new user reaches a prepared reply and speaks it", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "Start something" }).click();
  await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();

  const reply = page.getByRole("button", { name: /Speak .* reply:/ }).first();
  const replyText = (await reply.getAttribute("aria-label"))?.replace(/^Speak .* reply: /, "");
  await reply.click();
  await expect(page.getByRole("heading", { name: "Make it yours." })).toBeVisible();
  await page.getByRole("button", { name: "Speak this" }).click();

  await expect(page.getByRole("heading", { name: "Spoken" })).toBeVisible();
  await expect(page.locator("#spoken-log")).toContainText(replyText ?? "");
  await expect(page.getByText(/1 reply.*tap/)).toBeVisible();
});

test("personal details persist after a reload", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Personal details" }).click();
  await page.getByLabel("Name you use").fill("Avery");
  await page.getByLabel("Full name").fill("Avery Morgan");
  await page.getByRole("button", { name: "Save details" }).click();

  await page.reload();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Personal details" }).click();
  await expect(page.getByLabel("Name you use")).toHaveValue("Avery");
  await expect(page.getByLabel("Full name")).toHaveValue("Avery Morgan");
});

test("needs phrases speak and appear in the spoken log", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "My needs" }).click();
  await expect(page.getByRole("heading", { name: "My needs" })).toBeVisible();
  await page.getByRole("button", { name: "I'm in pain", exact: true }).click();

  await expect(page.getByText("I'm in pain", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/1 reply.*tap/)).toBeVisible();
});

test("offline mode offers local replies and conversation starters", async ({ page, context }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText(/Offline mode\./)).toBeVisible();

  await page.getByRole("button", { name: "Start something" }).click();
  await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();
  await expect(page.getByText(/Conversation starters are ready locally/)).toBeVisible();
});

test("privacy controls record consent and erase local Cadence data", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "Privacy" }).click();
  await page.getByRole("button", { name: "I understand" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.realModeConsent"))).toBe("1");

  await page.getByRole("button", { name: "Privacy" }).click();
  await page.getByRole("button", { name: "Erase all local data" }).click();
  await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.realModeConsent"))).toBeNull();
});

test("model routes reject oversized input and abusive request rates", async ({ request }) => {
  const port = process.env.PLAYWRIGHT_PORT ?? "3101";
  const headers = { Origin: `http://127.0.0.1:${port}`, "x-vercel-forwarded-for": "203.0.113.91" };
  const oversizedTranscript = Array.from({ length: 21 }, (_, index) => ({ speaker: `Speaker ${index}`, text: "A short caption." }));

  const oversizedResponse = await request.post("/api/predict", {
    headers,
    data: { transcript: oversizedTranscript, styleCard: "Clear and conversational." },
  });
  expect(oversizedResponse.status()).toBe(400);

  const responses = await Promise.all(Array.from({ length: 21 }, () => request.post("/api/tone", {
    headers,
    data: { text: "That sounds good.", tone: "warm" },
  })));
  expect(responses.filter((response) => response.status() === 429)).toHaveLength(1);
});
