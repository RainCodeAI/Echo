import { test } from "@playwright/test";
import { check, iPhone, overflowX, watchErrors } from "../helpers";

/** Settings AI usage card + dashboard banner in ok / warning / exceeded states. */
test("AI usage card and banner", async ({ context, browser }) => {
  const errors: string[] = [];
  const open = async (qs: string, c = context) => {
    const p = watchErrors(await c.newPage(), errors);
    await p.goto(`/ai-usage.html?${qs}`);
    await p.getByTestId("ai-usage").waitFor();
    return p;
  };

  let p = await open("level=ok");
  check("OK: hero number and limit", ((await p.getByTestId("ai-usage").textContent()) ?? "").includes("$4.12 of $25.00 limit"));
  check(
    "OK: state has icon + label",
    ((await p.getByTestId("ai-usage-level").textContent()) ?? "").trim() === "Within limit" && (await p.getByTestId("ai-usage-level").locator("svg").count()) === 1,
  );
  check(
    "OK: meter is an accessible progressbar",
    (await p.getByRole("progressbar").getAttribute("aria-valuenow")) === "16" && (await p.getByRole("progressbar").getAttribute("aria-valuetext")) === "$4.12 of $25.00",
  );
  check("OK: no dashboard banner", (await p.getByTestId("ai-usage-banner").count()) === 0);
  check("History table by month", (await p.locator("tbody tr").count()) === 3 && ((await p.locator("tbody tr").first().textContent()) ?? "").includes("Nov 2026"));

  p = await open("level=warning");
  check(
    "Warning: label, explanation and banner",
    ((await p.getByTestId("ai-usage-level").textContent()) ?? "").trim() === "Nearing limit" &&
      (await p.getByText("Over 80% of this month", { exact: false }).count()) === 1 &&
      ((await p.getByTestId("ai-usage-banner").textContent()) ?? "").includes("$21.30 of this month's $25.00 AI limit"),
  );

  p = await open("level=exceeded");
  check(
    "Exceeded: meter full, message, banner links to Settings",
    (await p.getByRole("progressbar").getAttribute("aria-valuenow")) === "100" &&
      (await p.getByTestId("ai-usage-banner").getByRole("link").getAttribute("href")) === "/dashboard/settings" &&
      ((await p.getByRole("alert").first().textContent()) ?? "").includes("AI picks up again on Dec 1"),
  );
  check("Exceeded: skipped notes counted", ((await p.getByTestId("ai-usage").textContent()) ?? "").includes("Skipped (limit)3"));

  const pp = await open("level=exceeded", await browser.newContext(iPhone));
  check("Fits a phone", (await overflowX(pp)) <= 0);
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
