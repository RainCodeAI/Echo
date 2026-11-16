import { test } from "@playwright/test";
import { check, fieldState, resetFieldState, setFieldState, watchErrors } from "../helpers";

/** Crew page: the one-time recording notice, and 6-digit PIN entry. */
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("recording notice before the first note", async ({ context, request }) => {
  await resetFieldState(request);
  await setFieldState(request, { noticeAcked: false });
  const errors: string[] = [];
  const page = watchErrors(await context.newPage(), errors);

  await page.goto("/field-entry.html");
  for (const d of "1234") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByTestId("recording-notice").waitFor();
  check("New crew member sees the notice, not the recorder", (await page.getByRole("button", { name: "Start recording" }).count()) === 0);

  // Reloading before acknowledging shows it again (a resumed session asks the server).
  await page.reload();
  await page.getByTestId("recording-notice").waitFor({ timeout: 5000 }).catch(() => {});
  check("Reload before acknowledging: notice again", (await page.getByTestId("recording-notice").count()) === 1);

  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByText("Hi, Luis").waitFor();
  check("After 'I understand': recorder", (await page.getByRole("button", { name: "Start recording" }).count()) === 1);
  const st = await fieldState(request);
  check(
    "Acknowledgement sent with the session token",
    st.ackCalls.length === 1 && st.ackCalls[0].teamMemberId === "member1" && st.ackCalls[0].verificationToken.startsWith("echo-entry:company1:member1"),
  );

  await page.reload();
  await page.getByText("Hi, Luis").waitFor();
  check("Reload after acknowledging: straight to the recorder", (await page.getByTestId("recording-notice").count()) === 0);

  // Switching user from the notice goes back to the PIN pad.
  await setFieldState(request, { noticeAcked: false });
  await page.goto("/field-entry.html");
  await page.getByTestId("recording-notice").waitFor({ timeout: 5000 }).catch(() => {});
  await page.getByRole("button", { name: /Switch user/ }).first().click();
  check("Switch user from the notice returns to the PIN pad", (await page.getByRole("button", { name: "1", exact: true }).count()) === 1);
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});

test("6-digit PIN entry", async ({ context, request }) => {
  await resetFieldState(request);
  const errors: string[] = [];
  const page = watchErrors(await context.newPage(), errors);
  await page.goto("/field-entry.html?pinlen=6");
  await page.getByRole("button", { name: "1", exact: true }).waitFor();
  check(
    "Six PIN dots and the 6-digit prompt",
    (await page.locator("span[aria-hidden].rounded-full").count()) === 6 && (await page.getByText("Enter your 6-digit crew PIN").count()) === 1,
  );
  for (const d of "1234") await page.getByRole("button", { name: d, exact: true }).click();
  await page.waitForTimeout(300);
  check("Doesn't submit after 4 digits", (await fieldState(request)).pinAttempts.length === 0);
  for (const d of "56") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByText("Hi, Luis").waitFor();
  check("Submits the 6-digit PIN and signs in", JSON.stringify((await fieldState(request)).pinAttempts) === JSON.stringify(["123456"]));
  check("No page errors", errors.length === 0, errors.join("|").slice(0, 300));
});
