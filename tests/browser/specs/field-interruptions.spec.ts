import { test, type Page } from "@playwright/test";
import { check, fieldState, iPhone, resetFieldState, watchErrors } from "../helpers";

/**
 * Crew page on a real phone: screen locks, calls, the page being killed
 * mid-recording, a blocked mic, in-app browsers, and the phone check.
 */
test.use({
  ...iPhone,
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

const APP = "/field-entry.html";
async function signIn(p: Page) {
  await p.goto(APP);
  for (const d of "1234") await p.getByRole("button", { name: d, exact: true }).click();
  await p.getByText("Hi, Luis").waitFor();
}
const interrupted = (p: Page) => p.getByTestId("recording-notice-interrupted");

test("recording interruptions keep the audio", async ({ context, request }) => {
  test.setTimeout(90_000);
  await resetFieldState(request);
  const errors: string[] = [];
  // Keep a handle on the mic stream and record wake-lock use.
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => ((w.__stream = await orig(c)) as MediaStream);
    w.__wake = 0;
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: async () => { (w.__wake as number)++; return { release: async () => { w.__wakeReleased = true; } }; } },
    });
  });
  const p = watchErrors(await context.newPage(), errors);
  await signIn(p);

  // 1. Screen locks / app switch mid-recording → stops, keeps the audio, says why.
  await p.getByRole("button", { name: "Start recording" }).click();
  await p.waitForTimeout(1500);
  check("Wake lock taken while recording", (await p.evaluate(() => (window as unknown as { __wake: number }).__wake)) === 1);
  await p.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await interrupted(p).waitFor({ timeout: 5000 }).catch(() => {});
  check(
    "Hidden page: recording stopped with an explanation, audio kept",
    (await interrupted(p).textContent())?.includes("screen locked") === true && (await p.getByText(/Audio attached/).isVisible()),
  );
  check("Wake lock released", (await p.evaluate(() => (window as unknown as { __wakeReleased?: boolean }).__wakeReleased)) === true);
  await p.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  // 2. A call takes the mic (track ends) → same.
  await p.getByRole("button", { name: "Start recording" }).click();
  await p.waitForTimeout(1200);
  check("Re-record clears the old notice", (await interrupted(p).count()) === 0);
  await p.evaluate(() => {
    const s = (window as unknown as { __stream: MediaStream }).__stream;
    s.getAudioTracks()[0].dispatchEvent(new Event("ended"));
  });
  await interrupted(p).waitFor({ timeout: 5000 }).catch(() => {});
  check("Track ended (call): stopped, explained, audio kept", (await interrupted(p).textContent())?.includes("call") === true && (await p.getByText(/Audio attached/).isVisible()));
  await p.locator("#transcript").fill("Interrupted memo");
  await p.getByRole("button", { name: "Submit note" }).click();
  await p.getByTestId("field-done-title").filter({ hasText: "Sent, Luis" }).waitFor();
  const st = await fieldState(request);
  check("Interrupted recording still sends with its audio", st.notes.length === 1 && !!st.notes[0].audioStorageId);

  // 3. The page is killed mid-recording → reopening restores what was saved.
  await p.getByRole("button", { name: "Record another" }).click();
  await p.getByRole("button", { name: "Start recording" }).click();
  await p.waitForTimeout(6500); // past one 5s checkpoint
  await p.close({ runBeforeUnload: false });
  const p2 = watchErrors(await context.newPage(), errors);
  await p2.goto(APP);
  await p2.getByText("Hi, Luis").waitFor();
  const restored = await p2.getByTestId("draft-restored").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(
    "Killed mid-recording: audio up to the last checkpoint is restored, with a note",
    restored && (await p2.getByText(/Audio attached \(\d+ KB/).isVisible()) && ((await interrupted(p2).textContent()) ?? "").includes("cut off"),
  );

  check("No uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
});

test("blocked mic and in-app browsers get instructions", async ({ browser }) => {
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...iPhone });
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    };
  });
  let p = watchErrors(await ctx.newPage(), errors);
  await signIn(p);
  await p.getByRole("button", { name: "Start recording" }).click();
  check("iPhone, mic blocked: how to allow it in Safari", (await p.getByText(/Website Settings → Microphone → Allow/).count()) === 1);
  await ctx.close();

  const fb = await browser.newContext({ ...iPhone, userAgent: `${iPhone.userAgent} [FBAN/FBIOS;FBAV/490.0]` });
  await fb.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    };
  });
  p = watchErrors(await fb.newPage(), errors);
  await signIn(p);
  await p.getByRole("button", { name: "Start recording" }).click();
  check("Facebook in-app browser: open in Safari", (await p.getByText(/Facebook's built-in browser.*Open in Safari/).count()) === 1);

  // Phone check flags it too.
  await p.getByText("Phone check").click();
  await p.getByTestId("phone-check").locator("li").first().waitFor();
  const browserRow = await p.getByTestId("phone-check").locator("li", { hasText: "Browser:" }).getAttribute("data-ok");
  check("Phone check: in-app browser marked as a problem", browserRow === "false");
  check("Phone check lists the essentials", (await p.getByTestId("phone-check").locator("li[data-ok]").count()) >= 10);
  await fb.close();
  check("No uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
});
