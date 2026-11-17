import { test, type Page } from "@playwright/test";
import { check, iPhone, lastCall, overflowX, watchErrors, windowValue } from "../helpers";

/** Note page: AI-drafted customer update in every state; sending via sms:/mailto:. */
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("customer update card", async ({ context, browser }) => {
  const errors: string[] = [];
  const open = async (qs: string): Promise<Page> => {
    const p = watchErrors(await context.newPage(), errors);
    await p.goto(`/customer-update.html?${qs}`);
    await p.getByTestId("customer-update").waitFor();
    return p;
  };

  let p = await open("state=nojob");
  check("No job: explains linking, no draft button", (await p.getByText("Link this note to a job").count()) === 1 && (await p.getByRole("button", { name: "Draft update" }).count()) === 0);

  p = await open("state=none");
  check(
    "Start: says what's covered and left out",
    (await p.getByText("Covers notes since your last update", { exact: false }).count()) === 1 &&
      (await p.getByText("Prices, crew names and your private notes are left out.", { exact: false }).count()) === 1,
  );
  await p.getByRole("button", { name: "Draft update" }).click();
  let c = await lastCall(p);
  check("Draft update requests a draft for this note", c?.name === "customerUpdates:requestDraft" && c.args.noteId === "n1");

  p = await open("state=generating");
  check("Generating shows progress", ((await p.getByRole("status").textContent()) ?? "").includes("Writing a draft from 3 notes"));

  p = await open("state=failed");
  check("Failed shows the reason and Try again", ((await p.getByRole("alert").textContent()) ?? "").includes("OPENAI_API_KEY") && (await p.getByRole("button", { name: "Try again" }).count()) === 1);

  p = await open("state=draft");
  check("Draft: recipient for text", (await p.getByTestId("recipient").textContent()) === "To Maria Ramirez · (555) 010-2000");
  check("Draft: character and text count", (await p.getByText(/characters · 2 texts/).count()) === 1);
  await p.getByLabel("Text message").fill("Hi Maria, tear-off is done. – Acme Roofing");
  await p.getByLabel("Text message").blur();
  await p.waitForTimeout(50);
  c = await lastCall(p);
  check("Edit saves on blur", c?.name === "customerUpdates:updateDraft" && c.args.updateId === "u1" && c.args.text === "Hi Maria, tear-off is done. – Acme Roofing");
  await p.getByRole("link", { name: "Send from my phone" }).click();
  await p.waitForTimeout(50);
  const opened = await windowValue<string>(p, "__opened");
  c = await lastCall(p);
  check(
    "Send by text: opens sms: with the edited text and marks sent",
    opened === "sms:5550102000?&body=Hi%20Maria%2C%20tear-off%20is%20done.%20%E2%80%93%20Acme%20Roofing" && c?.name === "customerUpdates:markSent" && c.args.via === "text",
    String(opened),
  );
  await p.getByRole("tab", { name: "Email" }).click();
  check("Email tab: recipient", (await p.getByTestId("recipient").textContent()) === "To Maria Ramirez · maria@example.com");
  const mail = (await p.getByRole("link", { name: "Send from my email" }).getAttribute("href")) ?? "";
  check("Email link has subject and body", mail.startsWith("mailto:maria@example.com?subject=Roof%20update%3A%20tear-off%20done&body=Hi%20Maria%2C%0A%0ATear-off"));
  await p.getByRole("button", { name: "Copy" }).click();
  await p.getByRole("button", { name: "Copied" }).waitFor();
  check("Copy (email tab) copies subject + body", (await p.evaluate(() => navigator.clipboard.readText())).startsWith("Roof update: tear-off done\n\nHi Maria,"));
  await p.getByRole("button", { name: "Discard draft" }).click();
  c = await lastCall(p);
  check("Discard", c?.name === "customerUpdates:discard" && c.args.updateId === "u1");

  p = await open("state=draft&nophone");
  check(
    "No phone: says so, no send-by-text link",
    ((await p.getByTestId("recipient").textContent()) ?? "").startsWith("No phone number on file for Maria Ramirez") &&
      (await p.getByRole("link", { name: "Send from my phone" }).count()) === 0,
  );
  await p.getByRole("button", { name: "Mark as sent" }).click();
  c = await lastCall(p);
  check("Mark as sent (sent another way)", c?.name === "customerUpdates:markSent" && c.args.via === "other");

  p = await open("state=sent");
  check(
    "Sent: shows how/when and the message",
    ((await p.getByRole("status").textContent()) ?? "").includes("Sent by text") && (await p.getByText("tear-off is done on the north slope", { exact: false }).count()) === 1,
  );
  await p.getByRole("button", { name: "Not sent? Undo" }).click();
  c = await lastCall(p);
  check("Undo sent", c?.name === "customerUpdates:undoSent" && c.args.updateId === "u1");

  const phone = watchErrors(await (await browser.newContext(iPhone)).newPage(), errors);
  await phone.goto("/customer-update.html?state=draft");
  await phone.getByTestId("customer-update").waitFor();
  check("Draft fits a phone", (await overflowX(phone)) <= 0);
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
