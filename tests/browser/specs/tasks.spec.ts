import { test } from "@playwright/test";
import { check, iPhone, lastCall, overflowX, watchErrors } from "../helpers";

/** Tasks page and the note panel: assign, tick, filter, AI hints. */
test("tasks page and assignees", async ({ page, browser }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/tasks.html");
  await page.getByTestId("task-list").waitFor();
  check(
    "Shows 3 open with high priority first",
    (await page.getByTestId("task-count").textContent()) === "3 open" &&
      ((await page.locator("[data-testid=task-list] li").first().textContent()) ?? "").includes("Tarp the kitchen leak"),
  );
  await page.getByLabel("Show tasks for").selectOption("unassigned");
  await page.waitForTimeout(100);
  check("Unassigned filter", (await page.locator("[data-testid=task-list] li").count()) === 2);
  await page.getByLabel("Show tasks for").selectOption("all");
  await page.getByLabel('Assign "Call Chen about downspout"').selectOption("user:u-dana");
  let c = await lastCall(page);
  check(
    "Assign sends person + expected title",
    c?.name === "voiceNotes:setActionItemAssignee" &&
      (c.args.assignee as { id: string }).id === "u-dana" &&
      c.args.expectedTitle === "Call Chen about downspout" &&
      c.args.index === 1,
    JSON.stringify(c?.args),
  );
  await page.getByLabel('Mark "Quote deck stain" done').click();
  c = await lastCall(page);
  check(
    "Tick sends completed + expected title",
    c?.name === "voiceNotes:setActionItemCompleted" && c.args.completed === true && c.args.expectedTitle === "Quote deck stain",
  );
  check(
    "Unassigned shows the AI hint",
    ((await page.getByLabel('Assign "Call Chen about downspout"').locator("option").first().textContent()) ?? "").includes("office"),
  );
  check("Links to the source note", (await page.getByRole("link", { name: "Downspout pulled off" }).getAttribute("href")) === "/dashboard/notes/n1");

  const phone = watchErrors(await (await browser.newContext(iPhone)).newPage(), errors);
  await phone.goto("/tasks.html");
  await phone.getByTestId("task-list").waitFor();
  const overflow = await overflowX(phone);
  check("Tasks page fits a phone", overflow <= 0, `overflow=${overflow}`);

  const note = watchErrors(await browser.newPage(), errors);
  await note.goto("/tasks.html?view=note");
  await note.getByLabel('Assign "Call the homeowner"').selectOption("member:m-ana");
  c = await lastCall(note);
  check(
    "Note panel assigns with expected title",
    c?.name === "voiceNotes:setActionItemAssignee" && (c.args.assignee as { id: string }).id === "m-ana" && c.args.expectedTitle === "Call the homeowner",
  );
  check("Note panel shows the current assignee", (await note.getByLabel('Assign "Tarp the kitchen leak today"').inputValue()) === "member:m-luis");
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 200));
});
