import { test } from "@playwright/test";
import { allCalls, check, iPhone, overflowX, watchErrors } from "../helpers";

/** Settings: company profile, urgent alerts (test alert) and the daily digest. */
test.use(iPhone);

test("urgent alert settings", async ({ page, browser }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.goto("/company-settings.html?role=owner");
  await page.locator("#alert-phone").fill("(555) 123-4567");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Saved.").waitFor();
  const save = (await allCalls(page)).find((c) => c.name === "companies:update");
  check(
    "Save sends the alert phone and the alerts switch",
    save?.args.alertPhone === "(555) 123-4567" && save?.args.notificationsEnabled === true,
    JSON.stringify(save?.args).slice(0, 140),
  );
  await page.getByRole("button", { name: "Send test alert" }).click();
  await page.getByText("sent ✓").waitFor();
  check("Test alert shows per-channel results", await page.getByText("not set up on the server yet").isVisible());
  const overflow = await overflowX(page);
  check("Fits a phone screen", overflow <= 0, `overflow=${overflow}`);

  const member = watchErrors(await (await browser.newContext()).newPage(), errors);
  await member.goto("/company-settings.html?role=member");
  await member.getByText("Only the workspace owner").waitFor();
  check(
    "Members see it read-only (phone + test button disabled)",
    (await member.locator("#alert-phone").isDisabled()) && (await member.getByRole("button", { name: "Send test alert" }).isDisabled()),
  );
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 200));
});

test.describe("digest", () => {
  test.use({ timezoneId: "America/Chicago" });

  test("daily digest settings", async ({ page }) => {
    const errors: string[] = [];
    watchErrors(page, errors);
    await page.goto("/company-settings.html?role=owner");
    const hour = page.locator("#digest-hour");
    check("Send-time picker disabled until the digest is on", await hour.isDisabled());
    check("Last digest status shown", ((await page.getByTestId("digest-last").textContent()) ?? "").includes("skipped (quiet day)"));
    await page.getByText("Daily digest email").click();
    check("Turning it on fills in the browser's timezone", (await page.locator("#company-timezone").inputValue()) === "America/Chicago");
    await hour.selectOption("6");
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.getByText("Saved.").waitFor();
    const save = (await allCalls(page)).find((c) => c.name === "companies:update");
    check(
      "Save sends digest on, 6am, and the timezone",
      save?.args.digestEnabled === true && save?.args.digestHour === 6 && save?.args.timezone === "America/Chicago",
    );
    await page.getByRole("button", { name: "Send digest now" }).click();
    await page.getByTestId("digest-result").waitFor();
    check("Send digest now shows the result", ((await page.getByTestId("digest-result").textContent()) ?? "").startsWith('Sent: "Acme Roofing'));
    const overflow = await overflowX(page);
    check("Fits a phone screen", overflow <= 0, `overflow=${overflow}`);
    check("No page errors", errors.length === 0, errors.join("|").slice(0, 200));
  });
});
