import { expect, test } from "@playwright/test";

test("digit-row and numpad Alt shortcuts work in the native browser", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.locator(".shell");
  await expect(
    page.getByRole("button", { name: "Toggle project panel" }),
  ).toBeVisible();
  await page.keyboard.press("Alt+Numpad0");
  await expect(panel).toHaveClass(/panel-collapsed/);
  await page.keyboard.press("Alt+0");
  await expect(panel).not.toHaveClass(/panel-collapsed/);

  await page.keyboard.press("Alt+Numpad1");
  const picker = page.getByRole("dialog", { name: "Choose project folder" });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+1");
  await expect(picker).toBeVisible();
});
