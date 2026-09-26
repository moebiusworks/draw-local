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

test("workspace dialogs trap context and restore their launcher focus", async ({
  page,
}) => {
  await page.goto("/");
  const browse = page.getByRole("button", { name: "Browse folders" });
  await browse.click();
  await expect(
    page.getByRole("dialog", { name: "Choose project folder" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(browse).toBeFocused();

  const licenses = page.getByRole("button", { name: "Licenses" });
  await licenses.click();
  await expect(page.getByRole("dialog", { name: "Licenses" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(licenses).toBeFocused();
});

test("library callback retains the active draft identity and window target", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Untitled draft" }).click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  const editorUrl = page.url();
  await expect
    .poll(() => page.evaluate(() => window.name))
    .toMatch(/^drawlocal[a-z0-9]+$/i);
  let libraryFetched = false;
  await page.route("https://libraries.excalidraw.com/**", (route) => {
    libraryFetched = true;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        type: "excalidrawlib",
        version: 2,
        libraryItems: [
          {
            id: "imported-library-item",
            status: "published",
            created: 1,
            elements: [],
          },
        ],
      }),
    });
  });
  const libraryUrl = "https://libraries.excalidraw.com/example.excalidrawlib";
  await page.goto(
    `${editorUrl}#addLibrary=${encodeURIComponent(libraryUrl)}&token=test`,
  );
  await expect(page.locator(".excalidraw")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => location.search))
    .toContain("draft=");
  await expect.poll(() => libraryFetched).toBe(true);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
});
