import { test, type Page } from "@playwright/test";
import { check, eventually, fieldState, resetFieldState, setFieldState, watchErrors } from "../helpers";

/**
 * Crew page: "never lose a memo". Session and draft survive reloads, offline
 * submits queue on the phone and send when back online (even after the tab
 * was closed), lost responses don't duplicate, expired sessions wait for PIN.
 */
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

async function enterPin(p: Page, pin = "1234") {
  for (const d of pin) await p.getByRole("button", { name: d, exact: true }).click();
}
async function record(p: Page, ms = 1500, text = "") {
  await p.getByRole("button", { name: "Start recording" }).click();
  await p.waitForTimeout(ms);
  await p.getByRole("button", { name: "Stop recording" }).click();
  await p.getByText(/Audio attached/).waitFor();
  if (text) await p.locator("#transcript").fill(text);
}
const idbCounts = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<{ drafts: number; queue: number }>((res) => {
        const r = indexedDB.open("echo-field");
        r.onsuccess = () => {
          const tx = r.result.transaction(["drafts", "queue"], "readonly");
          const a = tx.objectStore("drafts").count();
          const b = tx.objectStore("queue").count();
          tx.oncomplete = () => res({ drafts: a.result, queue: b.result });
        };
      }),
  );

test("offline capture queue", async ({ context, request }) => {
  test.setTimeout(150_000);
  await resetFieldState(request);
  const errors: string[] = [];
  let page = watchErrors(await context.newPage(), errors);
  const APP = "/field-entry.html";

  // 1. PIN → recorder; the session survives a reload.
  await page.goto(APP);
  await enterPin(page);
  await page.getByText("Hi, Luis").waitFor();
  await page.reload();
  check(
    "Session survives reload (no PIN re-entry)",
    await page.getByText("Hi, Luis").waitFor({ timeout: 5000 }).then(() => true, () => false),
  );

  // 2. An unsubmitted recording survives a reload.
  await record(page, 1500, "Leak at the north valley, need 2 bundles of shingles");
  await page.waitForTimeout(600); // draft autosave debounce
  await page.reload();
  const restored = await page.getByTestId("draft-restored").waitFor({ timeout: 5000 }).then(() => true, () => false);
  const restoredText = await page.locator("#transcript").inputValue().catch(() => "");
  const restoredAudio = await page.getByText(/Audio attached \(\d+ KB/).isVisible().catch(() => false);
  check("Draft restored after reload", restored && restoredText.includes("north valley") && restoredAudio, `audio=${restoredAudio}`);

  // 3. Submit offline → saved on the phone → sends when back online.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Submit note" }).click();
  const offlineTitle = await page.getByTestId("field-done-title").textContent();
  check("Offline submit shows 'Saved on this phone'", offlineTitle === "Saved on this phone", String(offlineTitle));
  await page.waitForTimeout(500);
  check("Nothing reached server while offline", (await fieldState(request)).notes.length === 0);
  const queuedCount = await page.getByTestId("field-queue-count").textContent().catch(() => "");
  check("Queue panel shows the waiting note", /1 note saved on this phone/.test(queuedCount ?? ""), String(queuedCount));

  await context.setOffline(false);
  check(
    "Back online → sent automatically",
    await page.getByTestId("field-done-title").filter({ hasText: "Sent, Luis" }).waitFor({ timeout: 15000 }).then(() => true, () => false),
  );
  let st = await fieldState(request);
  const n1 = st.notes[0];
  const audioUpload = n1?.audioStorageId ? st.uploads[n1.audioStorageId] : undefined;
  check(
    "Server got transcript + real audio upload + idempotency key",
    !!n1 && n1.rawTranscript.includes("north valley") && (audioUpload?.bytes ?? 0) > 1000 && typeof n1.clientUploadId === "string",
    n1 ? `audio=${audioUpload?.bytes}B` : "no note",
  );
  const counts = await idbCounts(page);
  check("Draft + queue cleared after send", counts.drafts === 0 && counts.queue === 0, JSON.stringify(counts));

  // 4. Offline submit, close the tab, reopen online → sends on load.
  await page.getByRole("button", { name: "Record another" }).click();
  await record(page, 1200, "Second memo, customer wants gutters quoted");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Submit note" }).click();
  await page.getByTestId("field-done-title").filter({ hasText: "Saved on this phone" }).waitFor();
  await page.close();
  await context.setOffline(false);
  page = watchErrors(await context.newPage(), errors);
  await page.goto(APP);
  check(
    "Tab closed while offline → sent when page reopened",
    await eventually(async () => (await fieldState(request)).notes.some((n) => n.rawTranscript.includes("gutters"))),
  );

  // 5. Lost response → the retry doesn't duplicate.
  await page.getByText("Hi, Luis").waitFor();
  await setFieldState(request, { mode: "lose-response" });
  await record(page, 800, "Third memo, response gets lost");
  await page.getByRole("button", { name: "Submit note" }).click();
  await page.getByRole("button", { name: "Send now" }).click({ timeout: 10000 }).catch(() => {});
  await page.getByTestId("field-done-title").filter({ hasText: "Sent, Luis" }).waitFor({ timeout: 20000 }).catch(() => {});
  st = await fieldState(request);
  const thirdCalls = st.createCalls.filter((c) => c.rawTranscript.includes("Third memo"));
  const thirdNotes = st.notes.filter((n) => n.rawTranscript.includes("Third memo"));
  check(
    "Lost response retried with same clientUploadId, no duplicate",
    thirdCalls.length >= 2 && new Set(thirdCalls.map((c) => c.clientUploadId)).size === 1 && thirdNotes.length === 1,
    `calls=${thirdCalls.length} notes=${thirdNotes.length}`,
  );
  check("Retry reused the uploaded audio (no re-upload)", new Set(thirdCalls.map((c) => c.audioStorageId)).size === 1);

  // 6. Expired session → note waits for the PIN → sends after it.
  await page.getByRole("button", { name: "Record another" }).click();
  await setFieldState(request, { mode: "expired" });
  await record(page, 800, "Fourth memo after session expiry");
  await page.getByRole("button", { name: "Submit note" }).click();
  check(
    "Expired session → note waits for PIN (kept)",
    await page.getByText(/Waiting for Luis to enter their PIN/).first().waitFor({ timeout: 10000 }).then(() => true, () => false),
  );
  await setFieldState(request, { mode: "ok" });
  await page.getByRole("button", { name: "Switch user" }).click();
  check("Waiting note visible on the PIN screen", await page.getByTestId("field-queue-count").waitFor().then(() => true, () => false));
  await enterPin(page);
  check(
    "After PIN re-entry the waiting note sends",
    await eventually(async () => (await fieldState(request)).notes.some((n) => n.rawTranscript.includes("Fourth memo"))),
  );

  check("No uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
});
