import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import { check, iPhone, lastCall, overflowX, watchErrors, windowValue } from "../helpers";

/** Materials: jobs overview and a job's merged order list (copy/share/email/CSV/order). */
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("materials order list", async ({ page, browser }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.setViewportSize({ width: 1000, height: 1000 });

  await page.goto("/materials.html");
  await page.getByTestId("materials-jobs").waitFor();
  const ov = (await page.getByTestId("materials-jobs").textContent()) ?? "";
  check("Overview: to-order badge and all-ordered badge", ov.includes("3 to order") && ov.includes("All ordered"));
  check("Overview: unlinked-notes hint", (await page.getByText("2 notes mention materials but aren't linked to a job.", { exact: false }).count()) === 1);
  check("Overview links to the job", (await page.getByRole("link", { name: /Ramirez reroof/ }).getAttribute("href")) === "/dashboard/materials?job=j1");

  await page.goto("/materials.html?job=j1");
  const list = page.getByTestId("to-order");
  await list.waitFor();
  const rows = await list.locator(":scope > li").allTextContents();
  check(
    "Merged lines with totals",
    rows.length === 3 && rows[0].includes("Architectural shingles") && rows[0].includes("15 bundles") && rows[1].includes("OSB") && rows[2].includes("2 boxes + a few"),
    rows.join(" | "),
  );
  check("Ordered item not in to-order list", !rows.join(" ").includes("Drip edge"));
  check("History shows the earlier order", ((await page.getByTestId("order-history").textContent()) ?? "").includes("Drip edge (~40 ft)"));
  await page.getByRole("button", { name: "From 2 notes" }).first().click();
  check("Sources link to the notes", (await page.getByRole("link", { name: "Rotten decking on north side" }).first().getAttribute("href")) === "/dashboard/notes/n2");

  await page.getByLabel('Include OSB sheathing 7/16"').uncheck();
  check("Unticking updates the count", (await page.getByTestId("selected-count").textContent()) === "2 of 3 selected");

  await page.getByRole("button", { name: "Copy list" }).click();
  await page.getByRole("status").waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(
    "Copy: text for the supply house, only ticked lines",
    clip.startsWith("Materials order: Ramirez reroof\nSite: 12 Oak St\nFrom Acme Roofing · ") &&
      clip.includes("- Architectural shingles: 15 bundles (Charcoal, match existing)") &&
      clip.includes("- Roofing nails: 2 boxes + a few") &&
      !clip.includes("OSB"),
    JSON.stringify(clip),
  );
  const mail = (await page.getByRole("link", { name: "Email" }).getAttribute("href")) ?? "";
  check(
    "Email: prefilled subject and body",
    mail.startsWith("mailto:?subject=Materials%20order%3A%20Ramirez%20reroof&body=") && decodeURIComponent(mail).includes("Architectural shingles: 15 bundles"),
  );
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  const csv = readFileSync(await dl.path(), "utf8");
  check(
    "CSV download",
    /^materials-ramirez-reroof-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) &&
      csv.split("\r\n")[1] === 'Architectural shingles,15,bundle,,"Charcoal, match existing",2',
    dl.suggestedFilename(),
  );

  await page.getByRole("button", { name: /Mark 2 ordered/ }).click();
  let c = await lastCall(page);
  check(
    "Mark ordered sends ticked keys + shown quantities",
    c?.name === "materials:markOrdered" &&
      c.args.jobId === "j1" &&
      JSON.stringify(c.args.lines) ===
        JSON.stringify([
          { key: "architectural shingle|bundle", quantityLabel: "15 bundles" },
          { key: "roofing nail|box", quantityLabel: "2 boxes + a few" },
        ]),
    JSON.stringify(c?.args),
  );
  await page.getByRole("button", { name: "Undo this order" }).click();
  c = await lastCall(page);
  check("Undo order", c?.name === "materials:undoOrder" && c.args.orderId === "o1");
  await page.getByLabel('Include OSB sheathing 7/16"').check();
  check("All ticked says 'Mark all ordered'", (await page.getByRole("button", { name: "Mark all ordered" }).count()) === 1);

  const phoneCtx = await browser.newContext(iPhone);
  await phoneCtx.addInitScript(() => {
    (navigator as unknown as { share: (d: unknown) => Promise<void> }).share = async (d) => {
      (window as unknown as { __shared: unknown }).__shared = d;
    };
  });
  const phone = watchErrors(await phoneCtx.newPage(), errors);
  await phone.goto("/materials.html?job=j1");
  await phone.getByTestId("to-order").waitFor();
  await phone.getByRole("button", { name: "Share" }).click();
  const shared = await windowValue<{ title: string; text: string }>(phone, "__shared");
  check("Share sheet gets title + text", shared?.title === "Materials: Ramirez reroof" && shared.text.includes("OSB sheathing"));
  check("Job view fits a phone", (await overflowX(phone)) <= 0);
  await phone.goto("/materials.html");
  await phone.getByTestId("materials-jobs").waitFor();
  check("Overview fits a phone", (await overflowX(phone)) <= 0);
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
