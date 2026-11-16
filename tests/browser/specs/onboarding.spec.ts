import { test } from "@playwright/test";
import { check, iPhone, lastCall, overflowX, watchErrors, windowValue } from "../helpers";

/** Getting-started checklist, crew poster (incl. one-page PDF), sample note. */
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test("setup checklist and crew poster", async ({ context, browser, baseURL }) => {
  const errors: string[] = [];
  const open = async (qs: string, c = context) => {
    const p = watchErrors(await c.newPage(), errors);
    await p.goto(`/onboarding.html?${qs}`);
    await p.waitForTimeout(200);
    return p;
  };
  const crewUrl = `${baseURL}/entry/k57c0mpany123`;

  let p = await open("done=0");
  check(
    "Fresh workspace: 0 of 4, first step's actions shown",
    ((await p.getByTestId("getting-started").textContent()) ?? "").includes("0 of 4 done") &&
      (await p.getByRole("link", { name: "Open settings" }).count()) === 1 &&
      (await p.getByRole("link", { name: "Set up alerts" }).count()) === 1,
  );
  check("Only the next required step (plus optional) shows buttons", (await p.getByRole("button", { name: "Add crew member" }).count()) === 0);

  p = await open("done=1");
  check(
    "After profile: crew step offers Add crew member",
    (await p.getByRole("button", { name: "Add crew member" }).count()) === 1 && (await p.getByTestId("step-profile").getAttribute("data-done")) === "true",
  );
  await p.getByRole("button", { name: "Add crew member" }).click();
  check("Add crew member opens the PIN dialog", (await p.getByRole("dialog").count()) === 1);

  p = await open("done=2");
  check("Share step: poster link", (await p.getByRole("link", { name: "Print QR poster" }).getAttribute("href")) === "/dashboard/poster");
  await p.getByRole("button", { name: "Copy crew link" }).click();
  await p.waitForTimeout(100);
  check(
    "Copy crew link copies the entry URL and marks shared",
    (await p.evaluate(() => navigator.clipboard.readText())) === crewUrl && (await lastCall(p))?.name === "onboarding:markShared",
  );

  p = await open("done=3");
  const crewLink = p.getByRole("link", { name: "Open crew page" });
  check("First-note step: open crew page in a new tab", (await crewLink.getAttribute("href")) === crewUrl && (await crewLink.getAttribute("target")) === "_blank");
  await p.getByRole("button", { name: "See a sample note" }).click();
  await p.waitForTimeout(100);
  check(
    "Sample note: created, then opened",
    (await lastCall(p))?.name === "onboarding:createSampleNote" && (await windowValue(p, "__pushed")) === "/dashboard/notes/sample123",
  );

  p = await open("done=0");
  await p.getByRole("button", { name: "Hide setup checklist" }).click();
  check("Hide", JSON.stringify((await lastCall(p))?.args) === JSON.stringify({ dismissed: true }));
  p = await open("done=2&dismissed");
  check(
    "Hidden: a small 'show' link with progress",
    (await p.getByRole("button", { name: "Show setup checklist (2 of 4 done)" }).count()) === 1 && (await p.getByTestId("getting-started").count()) === 0,
  );
  p = await open("done=4");
  check("All done: nothing shown", (await p.getByTestId("getting-started").count()) === 0 && (await p.locator("#root").textContent()) === "");
  p = await open("done=0&member");
  check("Members don't see it", (await p.locator("#root").textContent()) === "");

  // Poster
  p = await open("view=poster");
  await p.getByTestId("poster").locator("img").waitFor();
  const poster = (await p.getByTestId("poster").textContent()) ?? "";
  check(
    "Poster: company, bilingual steps, URL",
    ["Acme Roofing", "Scan the code", "Escanea el código", "Enter your crew PIN", "Ingresa tu PIN", "Toca grabar y habla", crewUrl].every((t) => poster.includes(t)),
  );
  const qr = p.getByTestId("poster").locator("img");
  check("Poster: QR image for the crew link", (await qr.getAttribute("alt")) === `QR code for ${crewUrl}` && ((await qr.getAttribute("src")) ?? "").startsWith("data:image/png"));
  check("Poster prints on exactly one Letter page", pdfPages(await p.pdf({ preferCSSPageSize: true, printBackground: true })) === 1);
  await p.emulateMedia({ media: "print" });
  check("Print view hides the toolbar", (await p.getByRole("button", { name: "Print" }).isVisible()) === false);
  await p.emulateMedia({ media: "screen" });
  await p.getByRole("tab", { name: "Truck sticker (4×4 in)" }).click();
  await p.getByTestId("poster").locator("img").waitFor();
  check("Sticker prints on one 4×4 page", pdfPages(await p.pdf({ preferCSSPageSize: true, printBackground: true })) === 1);
  await p.getByRole("button", { name: "Print" }).evaluate((b) => {
    window.print = () => {
      (window as unknown as { __printed: boolean }).__printed = true;
    };
    (b as HTMLButtonElement).click();
  });
  await p.waitForTimeout(100);
  check("Print marks the link as shared", (await windowValue(p, "__printed")) === true && (await lastCall(p))?.name === "onboarding:markShared");

  const phone = await browser.newContext(iPhone);
  for (const qs of ["done=1", "view=poster"]) {
    const pp = await open(qs, phone);
    check(`Fits a phone: ${qs}`, (await overflowX(pp)) <= 0);
  }
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
