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

test("Delete confirms and the platform bypass chord moves a focused draft to Trash", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page).toHaveURL(/draft=/);
  const id = new URL(page.url()).searchParams.get("draft")!;
  const row = page.locator(`#draft-${id}`);
  await row.focus();
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", { name: "Move drawing to Trash?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toBeFocused();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Alt+Backspace" : "Shift+Delete",
  );
  await expect(confirm).toHaveCount(0);
  await expect
    .poll(async () => (await page.request.get(`/api/draft/${id}`)).status())
    .toBe(400);
});
