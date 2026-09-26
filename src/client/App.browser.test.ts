import { expect, test } from "@playwright/test";
import { rm } from "node:fs/promises";

test.beforeEach(async () => {
  await rm("/tmp/draw-local-playwright", { recursive: true, force: true });
});

test("New creates a recoverable draft and Ctrl+S opens first-save", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const draft = page.getByRole("button", { name: "Untitled draft" });
  await expect(draft).toHaveCount(1);
  await draft.click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("heading", { name: "Save drawing" }),
  ).toBeVisible();
});

test("Ctrl+Alt+N is suppressed in a dialog and editable control", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Untitled draft" }).click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await page.keyboard.press("Control+s");
  const filename = page.getByRole("textbox", { name: "Filename" });
  await filename.focus();
  await page.keyboard.press("Control+Alt+N");
  await expect(
    page.getByRole("button", { name: "Untitled draft" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Save drawing" }),
  ).toBeVisible();
});
