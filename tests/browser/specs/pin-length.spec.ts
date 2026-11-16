import { test } from "@playwright/test";
import { check, lastCall, watchErrors } from "../helpers";

/** Team page: switching crew PINs between 4 and 6 digits. */
test("crew PIN length setting", async ({ context }) => {
  const errors: string[] = [];
  const open = async (qs: string) => {
    const p = watchErrors(await context.newPage(), errors);
    await p.goto(`/pin-length.html?${qs}`);
    await p.waitForTimeout(150);
    return p;
  };
  let p = await open("");
  check(
    "Shows current length and why 6 is better",
    ((await p.getByTestId("pin-length").textContent()) ?? "").includes("Crew PINs: 4 digits") && (await p.getByText("a million combinations", { exact: false }).count()) === 1,
  );
  await p.getByRole("button", { name: "Switch to 6 digits" }).click();
  check(
    "Confirm counts active crew whose PIN stops working (inactive ignored)",
    ((await p.getByTestId("pin-length-confirm").textContent()) ?? "").includes("2 crew members' current PIN will stop working"),
  );
  await p.getByTestId("pin-length-confirm").getByRole("button", { name: "Switch to 6 digits" }).click();
  await p.waitForTimeout(50);
  check("Sends length 6", JSON.stringify(await lastCall(p)) === JSON.stringify({ name: "companies:setPinLength", args: { length: 6 } }));
  p = await open("six");
  check("On 6: says who still needs a new PIN (active only)", ((await p.getByRole("status").textContent()) ?? "").includes("1 crew member needs a new 6-digit PIN"));
  p = await open("member");
  check("Hidden from members", (await p.getByTestId("pin-length").count()) === 0);
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
