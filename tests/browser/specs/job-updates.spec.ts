import { test } from "@playwright/test";
import { check, iPhone, lastCall, overflowX, watchErrors } from "../helpers";

/** Note page: apply / undo / dismiss AI-suggested job updates. */
test("suggested job updates", async ({ page, browser }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.goto("/job-updates.html");
  const box = page.getByTestId("job-suggestions");
  await box.waitFor();
  const text = (await box.textContent()) ?? "";
  check(
    "Describes each suggestion",
    ["Status → in progress", "Reschedule → 2026-11-17 08:00", "Add to job notes", "Site address → 14 Oak St"].every((t) => text.includes(t)),
  );
  check("Shows current values", text.includes("Now: scheduled") && text.includes("Now: not set"));
  check("Unsupported explains why", text.includes(`Echo can't change "crew size" automatically.`));
  await page.getByRole("button", { name: "Apply" }).first().click();
  let c = await lastCall(page);
  check(
    "Apply status sends guard fields",
    c?.name === "jobUpdates:apply" && c.args.index === 0 && c.args.expectedValue === "in_progress" && c.args.scheduledForMs === undefined,
    JSON.stringify(c?.args),
  );
  await page.getByLabel("Confirm new date and time").fill("2026-11-18T09:30");
  await page.getByRole("button", { name: "Apply" }).nth(1).click();
  c = await lastCall(page);
  const expected = await page.evaluate(() => new Date("2026-11-18T09:30").getTime());
  check("Reschedule sends the confirmed local time", c?.args.index === 1 && c.args.scheduledForMs === expected, JSON.stringify(c?.args));
  await page.getByRole("button", { name: "Dismiss suggestion" }).first().click();
  c = await lastCall(page);
  check("Dismiss", c?.name === "jobUpdates:dismiss" && c.args.dismissed === true && c.args.index === 0);
  await page.getByRole("button", { name: "Restore" }).click();
  c = await lastCall(page);
  check("Restore", c?.name === "jobUpdates:dismiss" && c.args.dismissed === false && c.args.index === 3);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(100);
  c = await lastCall(page);
  const after = (await box.textContent()) ?? "";
  check(
    "Undo sends index 2 and shows a clean server error",
    c?.name === "jobUpdates:undo" && c.args.index === 2 && after.includes("The job has changed since this was applied — edit the job directly instead.") && !after.includes("CONVEX"),
  );

  const phone = watchErrors(await (await browser.newContext(iPhone)).newPage(), errors);
  await phone.goto("/job-updates.html?nojob");
  await phone.getByTestId("job-suggestions").waitFor();
  check(
    "No job: asks to link one, no Apply",
    (await phone.getByText("Link a job below to apply").count()) === 2 && (await phone.getByRole("button", { name: "Apply" }).count()) === 0,
  );
  check("Fits a phone", (await overflowX(phone)) <= 0);
  await phone.goto("/job-updates.html");
  await phone.getByTestId("job-suggestions").waitFor();
  check("Fits a phone with date input", (await overflowX(phone)) <= 0);
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 200));
});
