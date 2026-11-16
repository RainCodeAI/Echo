import { test, type Page } from "@playwright/test";
import { check, eventually, fieldState, iPhone, resetFieldState, setFieldState, watchErrors } from "../helpers";

/** Crew page: "Which job?" picker — online, cached offline, queued, restored, none. */
test.use({
  ...iPhone,
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

async function record(p: Page, text: string) {
  await p.getByRole("button", { name: "Start recording" }).click();
  await p.waitForTimeout(900);
  await p.getByRole("button", { name: "Stop recording" }).click();
  await p.getByText(/Audio attached/).waitFor();
  await p.locator("#transcript").fill(text);
}

test("job picker", async ({ context, request }) => {
  test.setTimeout(120_000);
  await resetFieldState(request);
  const errors: string[] = [];
  const page = watchErrors(await context.newPage(), errors);
  const noteWith = async (text: string) => (await fieldState(request)).notes.find((n) => n.rawTranscript.includes(text));

  await page.goto("/field-entry.html");
  for (const d of "1234") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByText("Hi, Luis").waitFor();
  const picker = page.locator("#field-job");
  await picker.waitFor();
  const optionTexts = await picker.locator("option").allTextContents();
  const groups = await picker.locator("optgroup").evaluateAll((els) => els.map((e) => (e as HTMLOptGroupElement).label));
  check(
    "Picker lists Today + Other open jobs",
    groups.join("|") === "Today|Other open jobs" && optionTexts.some((t) => t.startsWith("Ramirez reroof")),
    groups.join("|"),
  );
  check("Default is 'No job / not sure'", (await picker.inputValue()) === "");

  // A. Pick a job, record, submit online → the note is linked.
  await picker.selectOption("job-running");
  check("Selected job shows its address", await page.getByText("412 Oak St").isVisible());
  await record(page, "First note on the Ramirez job");
  await page.getByRole("button", { name: "Submit note" }).click();
  await eventually(async () => (await fieldState(request)).notes.length === 1);
  check("Submitted note carries the picked job", (await noteWith("Ramirez"))?.jobId === "job-running");
  check("Done screen names the job", await page.getByText("Job: Ramirez reroof").isVisible());

  // B. Record another → the job is kept.
  await page.getByRole("button", { name: "Record another" }).click();
  check("Job stays selected for the next note", (await picker.inputValue()) === "job-running");

  // C. Reload with the job list unreachable → cached list + last pick.
  await setFieldState(request, { jobsDown: true });
  await page.reload();
  await page.getByText("Hi, Luis").waitFor();
  check(
    "Job list falls back to the copy saved on the phone",
    await page.getByTestId("jobs-cached").waitFor({ timeout: 5000 }).then(() => true, () => false),
  );
  check("Last-picked job preselected after reload", (await page.locator("#field-job").inputValue()) === "job-running");
  await setFieldState(request, { jobsDown: false });

  // D. Offline submit with another job → the queue row shows it → sent with it.
  await page.locator("#field-job").selectOption("job-pm");
  await record(page, "Second note for the Chen gutters");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Submit note" }).click();
  await page.getByTestId("field-done-title").waitFor();
  const row = (await page.getByTestId("field-queue").textContent()) ?? "";
  check("Queued note shows its job while offline", row.includes("Chen gutter install"), row.slice(0, 80));
  await context.setOffline(false);
  const sent = await eventually(async () => !!(await noteWith("Chen")), 15_000);
  check("Sent after reconnect with the right job", sent && (await noteWith("Chen"))?.jobId === "job-pm");

  // E. A restored draft keeps its job.
  await page.getByRole("button", { name: "Record another" }).click();
  await page.locator("#field-job").selectOption("job-next");
  await record(page, "Draft for Patel deck");
  await page.waitForTimeout(600);
  await page.locator("#field-job").selectOption("job-next");
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByTestId("draft-restored").waitFor();
  check("Restored draft keeps its job", (await page.locator("#field-job").inputValue()) === "job-next");

  // F. "No job" still works.
  await page.locator("#field-job").selectOption("");
  await page.getByRole("button", { name: "Submit note" }).click();
  await eventually(async () => !!(await noteWith("Patel")));
  check("'No job' submits unlinked", (await noteWith("Patel"))?.jobId === undefined);

  check("No uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
});
