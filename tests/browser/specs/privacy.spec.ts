import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { test, type BrowserContext, type Page } from "@playwright/test";
import { allCalls, check, iPhone, lastCall, overflowX, watchErrors, windowValue } from "../helpers";

/** Terms gate, crew recording notice, export zip, deletion, legal pages. */
test("privacy, consent, export and deletion", async ({ context, browser }) => {
  const errors: string[] = [];
  const open = async (qs: string, c: BrowserContext = context): Promise<Page> => {
    const p = watchErrors(await c.newPage(), errors);
    await p.goto(`/privacy.html?${qs}`);
    await p.waitForTimeout(150);
    return p;
  };

  let p = await open("view=terms");
  check("Terms gate blocks the owner's dashboard", (await p.getByTestId("terms-gate").count()) === 1 && (await p.getByTestId("dashboard").count()) === 0);
  check("Continue disabled until ticked", await p.getByRole("button", { name: "Continue" }).isDisabled());
  check(
    "Links to terms and privacy",
    (await p.getByRole("link", { name: "Terms of Service" }).getAttribute("href")) === "/terms" &&
      (await p.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")) === "/privacy",
  );
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Continue" }).click();
  let c = await lastCall(p);
  check("Accept sends the current version", c?.name === "privacy:acceptTerms" && c.args.version === "2026-11-15");
  p = await open("view=terms&renew");
  check("Changed terms say so", (await p.getByRole("heading").first().textContent()) === "We updated our terms");
  p = await open("view=terms&accepted");
  check("Accepted: dashboard shows", (await p.getByTestId("dashboard").count()) === 1);
  p = await open("view=terms&member");
  check("Members aren't blocked", (await p.getByTestId("dashboard").count()) === 1);

  p = await open("view=notice");
  check(
    "Notice names the company and asks for consent",
    ((await p.getByTestId("recording-notice").textContent()) ?? "").includes("Acme Roofing uses Echo") && (await p.getByText("ask them first", { exact: false }).count()) === 1,
  );
  await p.getByRole("button", { name: "I understand" }).click();
  await p.waitForTimeout(50);
  c = await lastCall(p);
  check(
    "I understand records it with the session + version",
    c?.name === "teamMembers:acknowledgeNotice" && c.args.verificationToken === "tok" && c.args.version === "2026-11-15" && (await windowValue(p, "__acked")) === true,
  );
  await p.getByRole("button", { name: /Switch user/ }).click();
  check("Switch user", (await windowValue(p, "__switched")) === true);

  p = await open("view=data");
  await p.getByRole("checkbox").check();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Export data" }).click()]);
  check("Export downloads a dated zip", /^echo-export-acme-roofing-\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const files = unzipSync(new Uint8Array(readFileSync(await dl.path())));
  check(
    "Zip has CSVs, raw data and the recording",
    !!files["notes.csv"] &&
      !!files["data.json"] &&
      Array.from(files["audio/2026-11-14-n1.webm"] ?? []).join() === "9,8,7" &&
      strFromU8(files["notes.csv"]).includes("Rot by chimney"),
    Object.keys(files).join(" "),
  );
  const tables = (await allCalls(p)).filter((x) => x.name === "privacy:exportPage").map((x) => x.args.table);
  check("Export read all 9 tables", tables.length === 9, tables.join(","));
  await p.getByRole("status").filter({ hasText: "Downloaded" }).waitFor();
  const del = p.getByRole("button", { name: "Delete workspace permanently" });
  check("Delete disabled until the name matches", await del.isDisabled());
  await p.getByLabel("Workspace name to confirm deletion").fill("acme roofing");
  await del.click();
  await p.waitForTimeout(50);
  c = await lastCall(p);
  check(
    "Delete sends the typed name, then signs out to /",
    c?.name === "privacy:deleteWorkspace" && c.args.confirmName === "acme roofing" && (await windowValue<{ redirectUrl: string }>(p, "__signedOut"))?.redirectUrl === "/",
  );
  p = await open("view=data&member");
  check(
    "Members can't export or delete",
    (await p.getByText("Only the workspace owner can export or delete data.").count()) === 1 && (await p.getByRole("button", { name: "Export data" }).count()) === 0,
  );

  p = await open("view=delete");
  await p.getByRole("button", { name: "Delete permanently" }).click();
  await p.getByRole("button", { name: "Yes, delete forever" }).click();
  await p.waitForTimeout(50);
  c = await lastCall(p);
  check("Delete note: two-step, then back to notes", c?.name === "privacy:deleteNote" && c.args.noteId === "n1" && (await windowValue(p, "__pushed")) === "/dashboard/notes");
  p = await open("view=delete&member");
  check("Delete note hidden from members", (await p.getByTestId("delete-note").count()) === 0);

  p = await open("view=privacy");
  const priv = (await p.locator("article").textContent()) ?? "";
  check(
    "Privacy page: draft banner, placeholders, subprocessors, export/delete",
    priv.includes("Draft.") &&
      priv.includes("[Company legal name]") &&
      ["Convex", "Clerk", "OpenAI", "Vercel", "Resend", "Twilio", "Sentry"].every((s) => priv.includes(s)) &&
      priv.includes("Settings → Your data"),
  );
  p = await open("view=tos");
  check("Terms page renders with AI-output caveat", ((await p.locator("article").textContent()) ?? "").includes("can be wrong or incomplete"));

  const phone = await browser.newContext(iPhone);
  for (const v of ["view=terms", "view=notice", "view=data", "view=privacy"]) {
    const pp = await open(v, phone);
    const o = await overflowX(pp);
    check(`Fits a phone: ${v}`, o <= 0, `overflow=${o}`);
  }
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
