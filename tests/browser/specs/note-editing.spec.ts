import { test } from "@playwright/test";
import { allCalls, check, iPhone, lastCall, overflowX, watchErrors } from "../helpers";

/** Note page: owner edits send only what changed; transcript re-run; AI retry options. */
test("owner edits on a note", async ({ page, browser }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  page.on("dialog", (d) => d.accept());
  await page.setViewportSize({ width: 900, height: 1400 });
  await page.goto("/note-editing.html");

  check("'Edited' markers shown for owner-edited fields", (await page.getByText("Edited", { exact: true }).count()) === 1);

  // 1. Edit the title only → only the title is sent.
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await page.getByTestId("ai-editor").waitFor();
  await page.locator("#edit-title").fill("North valley leak — urgent");
  await page.getByRole("button", { name: "Save changes" }).click();
  let c = await lastCall(page);
  check(
    "Changing the title sends only the title",
    c?.name === "voiceNotes:updateAiFields" && JSON.stringify(Object.keys(c.args).sort()) === '["noteId","title"]',
    JSON.stringify(c?.args),
  );

  // 2. Open + save without changes → no call.
  const before = (await allCalls(page)).length;
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  check("Saving with no changes sends nothing (nothing gets frozen)", (await allCalls(page)).length === before);

  // 3. Remove a material + add an action item → only those two lists.
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await page.getByRole("button", { name: "Remove material 1" }).click();
  await page.getByRole("button", { name: "Add action item" }).click();
  await page.getByLabel("Action item 3", { exact: true }).fill("Bring ladder stabilizer");
  await page.getByLabel("Action item 3 priority").selectOption("low");
  await page.getByRole("button", { name: "Save changes" }).click();
  c = await lastCall(page);
  const keys = JSON.stringify(Object.keys(c?.args ?? {}).sort());
  check("List edits send only materials + actionItems", keys === '["actionItems","materials","noteId"]', keys);
  const materials = c?.args.materials as { name: string }[];
  const items = c?.args.actionItems as { title: string; priority?: string }[];
  check(
    "Removed material gone, new item added with priority",
    materials.length === 1 && materials[0].name === "Drip edge" && items.at(-1)?.title === "Bring ladder stabilizer" && items.at(-1)?.priority === "low",
  );

  // 4. Tick an action item in view mode.
  await page.getByLabel('Mark "Confirm Friday with Ramirez" done').click();
  c = await lastCall(page);
  check(
    "Checkbox ticks the right action item",
    c?.name === "voiceNotes:setActionItemCompleted" && c.args.index === 1 && c.args.completed === true,
    JSON.stringify(c?.args),
  );

  // 5. Transcript correction with a re-run.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Transcript").fill("North valley is leaking, need FOUR bundles of shingles and drip edge.");
  await page.getByRole("button", { name: "Save & re-run AI" }).click();
  c = await lastCall(page);
  check(
    "Transcript save & re-run sends rerunAi",
    c?.name === "voiceNotes:updateTranscript" && c.args.rerunAi === true && String(c.args.rawTranscript).includes("FOUR"),
  );

  // 6. Retry, keeping or replacing owner edits.
  await page.getByRole("button", { name: "Retry AI" }).click();
  c = await lastCall(page);
  check("Retry keeps edits by default", c?.name === "voiceNotes:requestAiRetry" && c.args.overwriteOwnerEdits === undefined);
  await page.getByText(/Let AI replace my edits/).click();
  await page.getByRole("button", { name: "Retry AI" }).click();
  c = await lastCall(page);
  check("Retry can overwrite edits when ticked", c?.args.overwriteOwnerEdits === true);

  // Phone width: the editor fits without horizontal scroll.
  const phone = watchErrors(await (await browser.newContext(iPhone)).newPage(), errors);
  await phone.goto("/note-editing.html");
  await phone.getByRole("button", { name: "Edit" }).nth(1).click();
  const overflow = await overflowX(phone);
  check("Editor fits a phone screen (no horizontal scroll)", overflow <= 0, `overflow=${overflow}px`);

  check("No uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
});
