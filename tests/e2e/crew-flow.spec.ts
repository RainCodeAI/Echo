import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { convexRun, type E2ENote, type Seed } from "./convex";

/**
 * The crew flow against the real app and a real Convex backend: PIN, notice,
 * job picker, a real audio recording uploaded to Convex storage, the AI step
 * running (and failing cleanly without an OpenAI key), offline queueing.
 */
const seed = (): Seed => JSON.parse(readFileSync(join(__dirname, ".seed.json"), "utf8"));
const notes = (companyId: string) => convexRun<E2ENote[]>("e2e:notes", { companyId });

async function waitForNotes(companyId: string, check: (n: E2ENote[]) => boolean, ms = 60_000) {
  const end = Date.now() + ms;
  let last: E2ENote[] = [];
  while (Date.now() < end) {
    last = notes(companyId);
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

async function record(page: Page, text: string) {
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await page.getByText(/Audio attached/).waitFor();
  await page.locator("#transcript").fill(text);
}

test("crew records a note end to end", async ({ page, context }) => {
  const { companyId, jobId, pin } = seed();
  // The CI app uses placeholder Clerk keys; the crew page doesn't need Clerk.
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    if (!/Clerk/i.test(String(e))) errors.push(String(e));
  });

  await page.goto(`/entry/${companyId}`);
  await expect(page.getByText("E2E Roofing")).toBeVisible({ timeout: 30_000 });

  // A wrong PIN is refused by the real server.
  for (const d of "1111") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByText("Incorrect PIN.")).toBeVisible();

  // The right PIN → the one-time recording notice → the recorder.
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByTestId("recording-notice")).toBeVisible();
  await page.getByRole("button", { name: "I understand" }).click();
  await expect(page.getByText("Hi, Luis")).toBeVisible();

  // Pick the seeded job, record real (fake-mic) audio, submit.
  await page.locator("#field-job").selectOption(jobId);
  await record(page, "North valley is leaking, need three bundles of shingles.");
  await page.getByRole("button", { name: "Submit note" }).click();
  await expect(page.getByTestId("field-done-title")).toHaveText(/Sent, Luis/, { timeout: 30_000 });

  // In the database: the note, its uploaded audio, its job, and the AI step
  // having run (no OpenAI key in CI, so it fails with a clear reason).
  let saved = await waitForNotes(companyId, (n) => n.length === 1 && n[0].aiStatus === "failed");
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ jobId, hasAudio: true, status: "ready", aiStatus: "failed" });
  expect(saved[0].rawTranscript).toContain("three bundles");
  expect(saved[0].aiErrorMessage).toMatch(/AI unavailable|OPENAI_API_KEY/);

  // Offline: saved on the phone, then sent when the connection is back.
  await page.getByRole("button", { name: "Record another" }).click();
  await record(page, "Second memo recorded with no signal.");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Submit note" }).click();
  await expect(page.getByTestId("field-done-title")).toHaveText("Saved on this phone");
  await context.setOffline(false);
  saved = await waitForNotes(companyId, (n) => n.some((x) => x.rawTranscript.includes("no signal")));
  expect(saved.filter((x) => x.rawTranscript.includes("no signal"))).toHaveLength(1);

  expect(errors).toEqual([]);
});
