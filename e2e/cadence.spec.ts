import { expect, test } from "@playwright/test";

async function openFreshApp(page: import("@playwright/test").Page) {
  await page.goto("/app");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

async function openSettingsMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Open Cadence settings and help" }).click();
}
async function openMoreSection(page: import("@playwright/test").Page, label: string) {
  await openSettingsMenu(page);
  await page.locator("#more-menu summary").filter({ hasText: label }).click();
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

test("new users can explicitly skip optional onboarding setup", async ({ page }) => {
  await openFreshApp(page);
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.onboardingComplete"))).toBe("1");
});

test("normal sessions restore prepared replies after a refresh", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "Start something" }).click();
  await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.session"))).toContain("suggestionMode");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Speak .* reply:/ })).toHaveCount(4);
});

test("single-switch scanning selects a highlighted reply with Space", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "Start something" }).click();
  await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();
  const target = page.getByRole("button", { name: /Speak .* reply:/ }).first();
  const targetText = (await target.getAttribute("aria-label"))?.replace(/^Speak .* reply: /, "");

  await openSettingsMenu(page);
  await page.getByRole("button", { name: "Scanning mode", exact: true }).click();
  await expect(page.getByText(/Scanning is on/)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator("#spoken-log")).toContainText(targetText ?? "");
});

test("Cadence brand returns to the landing page", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await expect(page.getByRole("link", { name: "Cadence home" })).toHaveAttribute("href", "/");
  await page.getByRole("link", { name: "Cadence home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("theme preference stays consistent between landing and demo", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.setItem("cadence.theme", "light"));
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("link", { name: "Open demo" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "Open demo" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("landing and quick tour explain the access choices", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose the access that fits today." })).toBeVisible();
  await expect(page.getByText("Looking never speaks for you")).toBeVisible();

  await openFreshApp(page);
  await page.getByRole("button", { name: "Show me how" }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Choose the access method that fits" })).toBeVisible();
  await expect(page.getByText(/always confirm before Cadence speaks/)).toBeVisible();
});

test("eye-gaze setup requires an explicit local camera action", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await page.getByRole("button", { name: "Set up eye-gaze focus" }).click();
  await expect(page.getByRole("heading", { name: "Eye-gaze focus" })).toBeVisible();
  await expect(page.getByText("Camera stays local")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start local camera" })).toBeVisible();
});

test("personal details persist after a reload", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await openMoreSection(page, "Personalize Cadence");
  await page.getByRole("button", { name: /Personal details/ }).click();
  await page.getByLabel("Name you use").fill("Avery");
  await page.getByLabel("Full name").fill("Avery Morgan");
  await page.getByRole("button", { name: "Save details" }).click();

  await page.reload();
  await openMoreSection(page, "Personalize Cadence");
  await page.getByRole("button", { name: /Personal details/ }).click();
  await expect(page.getByLabel("Name you use")).toHaveValue("Avery");
  await expect(page.getByLabel("Full name")).toHaveValue("Avery Morgan");
});

test("confirmed vocabulary and conversation kits persist locally", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);

  await openMoreSection(page, "Personalize Cadence");
  await page.getByRole("button", { name: /Words to recognize/ }).click();
  await page.getByLabel("One correction per line").fill("Jogn = John\nMya = Maya");
  await page.getByRole("button", { name: "Save words" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.personalVocabulary"))).toContain("Jogn");

  await openMoreSection(page, "Personalize Cadence");
  await page.getByRole("button", { name: /Conversation kits/ }).click();
  await page.getByLabel("Name this conversation kit").fill("Family dinner");
  await page.getByRole("button", { name: "Save kit" }).click();
  await expect(page.getByRole("heading", { name: "Family dinner" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.reload();
  await openMoreSection(page, "Personalize Cadence");
  await page.getByRole("button", { name: /Conversation kits/ }).click();
  await expect(page.getByRole("heading", { name: "Family dinner" })).toBeVisible();
});

test("private sessions do not persist active conversation recovery", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await openMoreSection(page, "Privacy & session");
  await page.getByRole("button", { name: "Private session: off", exact: true }).click();
  await openMoreSection(page, "Privacy & session");
  await expect(page.getByRole("button", { name: "Private session: on", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.lastSuggestions"))).toBeNull();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.session"))).toBeNull();
});

test("a user can inspect and reject the caption context behind a reply", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);
  await openMoreSection(page, "Help & testing");
  await page.getByRole("button", { name: /Play demo conversation/ }).click();

  const reply = page.getByRole("button", { name: /Speak .* reply:/ }).first();
  await reply.click();
  await expect(page.getByText("Latest caption", { exact: true })).toBeVisible();
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

test("repair phrases and a local help reminder remain user-controlled", async ({ page }) => {
  await openFreshApp(page);
  await skipOnboarding(page);

  await page.getByRole("button", { name: /Repair a mix-up/ }).click();
  await page.getByRole("button", { name: "Speak Please repeat that.", exact: true }).click();
  await expect(page.locator("#spoken-log")).toContainText("Please repeat that.");

  await page.getByRole("button", { name: "My needs" }).click();
  await page.getByRole("button", { name: "Set a personal help reminder" }).click();
  await expect(page.getByRole("heading", { name: "What should happen next?" })).toBeVisible();
  await page.getByLabel("Your reminder").fill("Ask Sam to follow the plan by the phone.");
  await page.getByRole("button", { name: "Save reminder" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.helpPlan"))).toContain("Ask Sam");
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
  await openMoreSection(page, "Privacy & session");
  await page.getByRole("button", { name: "Privacy controls" }).click();
  await page.getByRole("button", { name: "I understand" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cadence.realModeConsent"))).toBe("1");

  await openMoreSection(page, "Privacy & session");
  await page.getByRole("button", { name: "Privacy controls" }).click();
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

  const oversizedKeywordResponse = await request.post("/api/expand", {
    headers: { ...headers, "x-vercel-forwarded-for": "203.0.113.92" },
    data: { keyword: "x".repeat(41), transcript: [{ speaker: "Maya", text: "Would a picnic work?" }], styleCard: "Clear and conversational." },
  });
  expect(oversizedKeywordResponse.status()).toBe(400);

  const oversizedToneResponse = await request.post("/api/tone", {
    headers: { ...headers, "x-vercel-forwarded-for": "203.0.113.93" },
    data: { text: "x".repeat(601), tone: "warm" },
  });
  expect(oversizedToneResponse.status()).toBe(400);

  const oversizedSpeechResponse = await request.post("/api/speak", {
    headers: { ...headers, "x-vercel-forwarded-for": "203.0.113.94" },
    data: { text: "x".repeat(601), tone: "warm" },
  });
  expect(oversizedSpeechResponse.status()).toBe(400);

  const responses = await Promise.all(Array.from({ length: 21 }, () => request.post("/api/tone", {
    headers,
    data: { text: "That sounds good.", tone: "warm" },
  })));
  expect(responses.filter((response) => response.status() === 429)).toHaveLength(1);
});
