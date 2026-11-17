import { test } from "@playwright/test";
import { check, iPhone, lastCall, overflowX, watchErrors, windowValue } from "../helpers";

/** Team page office roster: remove, make owner, leave. */
test("office user management", async ({ context, browser }) => {
  const errors: string[] = [];
  const open = async (qs: string, c = context) => {
    const p = watchErrors(await c.newPage(), errors);
    await p.goto(`/office-users.html?${qs}`);
    await p.getByTestId("office-user-Pat Office").waitFor();
    return p;
  };

  let p = await open("");
  check("Owner: no actions on own row", (await p.getByTestId("office-user-Dana Owner").getByRole("button").count()) === 0);
  check(
    "Owner: Make owner + Remove on members",
    (await p.getByRole("button", { name: "Make Pat Office the owner" }).count()) === 1 && (await p.getByRole("button", { name: "Remove Sam Estimator" }).count()) === 1,
  );
  await p.getByRole("button", { name: "Remove Pat Office" }).click();
  check(
    "Remove asks first and explains",
    ((await p.getByTestId("confirm-remove").textContent()) ?? "").includes("their open action items become unassigned") &&
      (await p.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)) === 0,
  );
  await p.getByRole("button", { name: "Cancel" }).click();
  check("Cancel closes the confirm", (await p.getByTestId("confirm-remove").count()) === 0);
  await p.getByRole("button", { name: "Remove Pat Office" }).click();
  await p.getByRole("button", { name: "Remove Pat Office" }).click();
  await p.waitForTimeout(50);
  let c = await lastCall(p);
  check("Remove sends the user id", c?.name === "officeUsers:removeMember" && c.args.userId === "u2");
  await p.getByRole("button", { name: "Make Sam Estimator the owner" }).click();
  check("Transfer explains what moves", ((await p.getByTestId("confirm-transfer").textContent()) ?? "").includes("You'll become a member"));
  await p.getByRole("button", { name: "Make owner", exact: true }).click();
  await p.waitForTimeout(50);
  c = await lastCall(p);
  check("Transfer sends the user id", c?.name === "officeUsers:transferOwnership" && c.args.userId === "u3");

  p = await open("fail");
  await p.getByRole("button", { name: "Remove Pat Office" }).click();
  await p.getByRole("button", { name: "Remove Pat Office" }).click();
  await p.getByRole("alert").waitFor();
  check(
    "Server error shown cleanly, confirm stays open",
    (await p.getByRole("alert").textContent()) === "The owner can't be removed." && (await p.getByTestId("confirm-remove").count()) === 1,
  );

  p = await open("member");
  check("Member: only 'Leave' on own row", (await p.getByRole("button", { name: "Leave" }).count()) === 1 && (await p.getByRole("button", { name: /Remove|Make/ }).count()) === 0);
  await p.getByRole("button", { name: "Leave" }).click();
  await p.getByRole("button", { name: "Leave workspace" }).click();
  await p.waitForTimeout(50);
  c = await lastCall(p);
  check("Leave, then signed out to /", c?.name === "officeUsers:leave" && (await windowValue<{ redirectUrl: string }>(p, "__signedOut"))?.redirectUrl === "/");

  const pp = await open("", await browser.newContext(iPhone));
  await pp.getByRole("button", { name: "Make Pat Office the owner" }).click();
  check("Fits a phone (with a confirm open)", (await overflowX(pp)) <= 0);
  const nameCut = await pp.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="office-user-"] p.truncate')].some((el) => el.scrollWidth > el.clientWidth),
  );
  check("Names aren't truncated on a phone", !nameCut);
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
