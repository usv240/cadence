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

test("confirmed vocabulary and conversation kits persist locally", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Words Cadence should recognize" }).click();
  await page.getByLabel("One correction per line").fill("Jogn = John\nMya = Maya");
  await page.getByRole("button", { name: "Save words" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.personalVocabulary"))).toContain("Jogn");

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Conversation kits" }).click();
  await page.getByLabel("Name this conversation kit").fill("Family dinner");
  await page.getByRole("button", { name: "Save kit" }).click();
  await expect(page.getByRole("heading", { name: "Family dinner" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.reload();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Conversation kits" }).click();
  await expect(page.getByRole("heading", { name: "Family dinner" })).toBeVisible();
});

test("private sessions do not persist active conversation recovery", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "Private session", exact: true }).click();
  await expect(page.getByText(/Private session is on/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.lastSuggestions"))).toBeNull();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.session"))).toBeNull();
});

test("a user can inspect and reject the caption context behind a reply", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Play demo conversation" }).click();

  const reply = page.getByRole("button", { name: /Speak .* reply:/ }).first();
  await reply.click();
  await expect(page.getByText("Based on the latest caption")).toBeVisible();
  await page.getByRole("button", { name: "Wrong context" }).click();
  await expect(page.getByRole("button", { name: "Review uncertain caption" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Make it yours." })).toHaveCount(0);
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
