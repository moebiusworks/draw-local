import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const git = promisify(execFile);
const testRoot = "/tmp/draw-local-playwright/project";
const drawing = {
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
};

test.beforeEach(async () => {
  await rm("/tmp/draw-local-playwright", { recursive: true, force: true });
});

async function drawRectangle(page: Page) {
  await expect(page.locator(".excalidraw")).toBeVisible();
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  const canvas = page.locator(".excalidraw canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Editor canvas was not laid out");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 60, { steps: 4 });
  await page.mouse.up();
}

async function savedElements(page: Page, projectId: string, file: string) {
  const response = await page.request.get(
    `/api/project/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(file)}`,
  );
  expect(response.ok()).toBeTruthy();
  return (
    (await response.json()).document as { elements: Array<{ id: string }> }
  ).elements;
}

function projectFile(page: Page, projectId: string, file: string) {
  return page
    .locator("div.project-root")
    .filter({
      has: page.locator(
        `button[data-project-id="${projectId}"][data-project-path=""]`,
      ),
    })
    .locator("button.file")
    .filter({ hasText: file });
}

test("a draft autosaves an editor change and survives browser restart", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page).toHaveURL(/draft=/);
  const id = new URL(page.url()).searchParams.get("draft")!;
  await drawRectangle(page);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/draft/${id}`);
      return ((await response.json()).document as typeof drawing).elements
        .length;
    })
    .toBe(1);
  await page.reload();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page).toHaveURL(new RegExp(`draft=${id}`));
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/draft/${id}`);
      return ((await response.json()).document as typeof drawing).elements
        .length;
    })
    .toBe(1);
});

test("a pending save stays with its project when another project has the same path", async ({
  page,
}) => {
  const secondRoot = "/tmp/draw-local-playwright/second-project";
  await mkdir(secondRoot, { recursive: true });
  const registered = await page.request.post("/api/projects", {
    data: { path: secondRoot, name: "Second" },
  });
  expect(registered.ok()).toBeTruthy();
  const second = await registered.json();
  for (const projectId of ["default", second.id]) {
    const response = await page.request.post(
      `/api/project/file?projectId=${projectId}&path=shared.excalidraw`,
      { data: { document: drawing } },
    );
    expect(response.ok()).toBeTruthy();
  }
  await page.goto("/");
  const firstRoot = page.locator(
    'button[data-project-id="default"][data-project-path=""]',
  );
  await firstRoot.click();
  await projectFile(page, "default", "shared.excalidraw").click();
  await expect(page).toHaveURL(/project=default/);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route("**/api/project/file?*", async (route) => {
    if (
      route.request().method() === "PUT" &&
      new URL(route.request().url()).searchParams.get("projectId") === "default"
    ) {
      reached();
      await pending;
    }
    await route.continue();
  });
  await drawRectangle(page);
  await intercepted;
  const secondRootButton = page.locator(
    `button[data-project-id="${second.id}"][data-project-path=""]`,
  );
  await secondRootButton.click();
  await projectFile(page, second.id, "shared.excalidraw").click();
  await expect(page).toHaveURL(new RegExp(`project=${second.id}`));
  await drawRectangle(page);
  release();
  await expect
    .poll(
      async () =>
        (await savedElements(page, "default", "shared.excalidraw")).length,
    )
    .toBe(1);
  await expect
    .poll(
      async () =>
        (await savedElements(page, second.id, "shared.excalidraw")).length,
    )
    .toBe(1);
  const firstElements = await savedElements(
    page,
    "default",
    "shared.excalidraw",
  );
  const secondElements = await savedElements(
    page,
    second.id,
    "shared.excalidraw",
  );
  expect(firstElements[0]?.id).not.toBe(secondElements[0]?.id);
});

test("a failed draft autosave keeps the editor content available for first Save", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page).toHaveURL(/draft=/);
  const id = new URL(page.url()).searchParams.get("draft")!;
  let failed = false;
  await page.route(`**/api/draft/${id}`, async (route) => {
    if (!failed && route.request().method() === "PUT") {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Disk unavailable" }),
      });
    } else await route.continue();
  });
  await drawRectangle(page);
  await expect(page.getByRole("status")).toContainText(
    "Save failed: Disk unavailable",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save drawing" });
  await dialog
    .getByRole("textbox", { name: "Filename" })
    .fill("recovered.excalidraw");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await savedElements(page, "default", "recovered.excalidraw")).length,
  ).toBe(1);
});

test("an external edit creates a recoverable draft without overwriting the project", async ({
  page,
}) => {
  const target = path.join(testRoot, "conflict.excalidraw");
  const created = await page.request.post(
    "/api/project/file?projectId=default&path=conflict.excalidraw",
    {
      data: { document: drawing },
    },
  );
  expect(created.ok()).toBeTruthy();
  await page.goto("/?project=default&file=conflict.excalidraw");
  await expect(page.getByRole("status")).toContainText("Saved");
  await writeFile(
    target,
    JSON.stringify({ ...drawing, appState: { external: true } }),
  );
  await drawRectangle(page);
  await expect(page.getByRole("status")).toContainText(
    "Save conflicted: recovery draft",
  );
  const status = await page.getByRole("status").innerText();
  const id = status.match(/recovery draft ([a-f\d-]+)/)?.[1];
  expect(id).toBeTruthy();
  const response = await page.request.get(`/api/draft/${id}`);
  expect(response.ok()).toBeTruthy();
  expect(
    ((await response.json()).document as typeof drawing).elements,
  ).toHaveLength(1);
  expect(
    (JSON.parse(await readFile(target, "utf8")) as typeof drawing).appState,
  ).toEqual({ external: true });
  await page
    .locator(".draft-row button.file")
    .filter({ hasText: /Untitled-/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`draft=${id}`));
});

test("first Save transfers a draft to a project on another filesystem", async ({
  page,
}) => {
  test.skip(
    process.platform !== "linux",
    "The test uses Linux tmpfs for a second filesystem",
  );
  const projectRoot = await mkdtemp("/dev/shm/draw-local-cross-fs-");
  try {
    test.skip(
      (await stat(projectRoot)).dev === (await stat("/tmp")).dev,
      "No second filesystem available",
    );
    const registered = await page.request.post("/api/projects", {
      data: { path: projectRoot, name: "Cross filesystem" },
    });
    expect(registered.ok()).toBeTruthy();
    const project = await registered.json();
    await page.goto("/");
    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(page).toHaveURL(/draft=/);
    const id = new URL(page.url()).searchParams.get("draft")!;
    await drawRectangle(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Save drawing" });
    await dialog
      .getByRole("combobox", { name: "Project" })
      .selectOption(project.id);
    await dialog
      .getByRole("textbox", { name: "Filename" })
      .fill("transferred.excalidraw");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
    expect(
      (await savedElements(page, project.id, "transferred.excalidraw")).length,
    ).toBe(1);
    expect((await page.request.get(`/api/draft/${id}`)).status()).toBe(400);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("New creates a recoverable draft and Ctrl+S opens first-save", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const draft = page.getByRole("button", {
    name: "Untitled draft",
    exact: true,
  });
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
  await page
    .getByRole("button", { name: "Untitled draft", exact: true })
    .click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await page.keyboard.press("Control+s");
  const filename = page.getByRole("textbox", { name: "Filename" });
  await filename.focus();
  await page.keyboard.press("Control+Alt+N");
  await expect(
    page.getByRole("button", { name: "Untitled draft", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Save drawing" }),
  ).toBeVisible();
});

test("Save does not reset an active first-save dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Untitled draft", exact: true })
    .click();
  await page.keyboard.press("Control+s");
  const filename = page.getByRole("textbox", { name: "Filename" });
  await filename.fill("custom.excalidraw");
  await page.keyboard.press("Control+s");
  await expect(filename).toHaveValue("custom.excalidraw");
});

test("first Save recovers from a collision and Save As keeps both files", async ({
  page,
}) => {
  await page.goto("/");
  const existing = await page.request.post(
    "/api/project/file?projectId=default&path=collision.excalidraw",
    {
      data: { document: drawing },
    },
  );
  expect(existing.ok()).toBeTruthy();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Untitled draft", exact: true })
    .click();
  await page.keyboard.press("Control+s");
  const dialog = page.getByRole("dialog", { name: "Save drawing" });
  const filename = dialog.getByRole("textbox", { name: "Filename" });
  await filename.fill("collision.excalidraw");
  const rejectedSave = page.waitForResponse(
    (response) =>
      response.url().includes("/api/draft/") &&
      response.url().endsWith("/save"),
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  expect((await rejectedSave).status()).toBe(400);
  await expect(dialog).toBeVisible();
  await expect(filename).toHaveValue("collision.excalidraw");
  await filename.fill("saved.excalidraw");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.request.get(
    "/api/project/file?projectId=default&path=saved.excalidraw",
  );
  expect(saved.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save As" }).click();
  const copy = page.getByRole("dialog", { name: "Save As" });
  await copy.getByRole("textbox", { name: "Filename" }).fill("copy.excalidraw");
  await copy.getByRole("button", { name: "Save", exact: true }).click();
  await expect(copy).toHaveCount(0);
  expect(
    (
      await page.request.get(
        "/api/project/file?projectId=default&path=copy.excalidraw",
      )
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.get(
        "/api/project/file?projectId=default&path=saved.excalidraw",
      )
    ).ok(),
  ).toBeTruthy();
});

test("Git states survive two folder expansions, focus, and manual refresh", async ({
  page,
}) => {
  await mkdir(path.join(testRoot, "first"), { recursive: true });
  await mkdir(path.join(testRoot, "second"), { recursive: true });
  await git("git", ["init"], { cwd: testRoot });
  await git("git", ["config", "user.name", "Test"], { cwd: testRoot });
  await git("git", ["config", "user.email", "test@example.invalid"], {
    cwd: testRoot,
  });
  for (const folder of ["first", "second"])
    await writeFile(
      path.join(testRoot, folder, `${folder}.excalidraw`),
      JSON.stringify(drawing),
    );
  await git("git", ["add", "."], { cwd: testRoot });
  await git("git", ["commit", "-m", "initial"], { cwd: testRoot });
  for (const folder of ["first", "second"])
    await writeFile(
      path.join(testRoot, folder, `${folder}.excalidraw`),
      JSON.stringify({ ...drawing, elements: [{ id: folder }] }),
    );
  await page.goto("/");
  await page
    .locator('button[data-project-id="default"][data-project-path=""]')
    .click();
  await page
    .locator('button[data-project-id="default"][data-project-path="first"]')
    .click();
  await page
    .locator('button[data-project-id="default"][data-project-path="second"]')
    .click();
  const first = page
    .locator("button.file")
    .filter({ hasText: "first.excalidraw" });
  const second = page
    .locator("button.file")
    .filter({ hasText: "second.excalidraw" });
  await expect(first).toHaveAttribute("title", "Modified");
  await expect(second).toHaveAttribute("title", "Modified");
  await git("git", ["add", "first/first.excalidraw"], { cwd: testRoot });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(first).toHaveAttribute("title", "Staged");
  await expect(second).toHaveAttribute("title", "Modified");
  await writeFile(
    path.join(testRoot, "second", "second.excalidraw"),
    JSON.stringify({ ...drawing, elements: [{ id: "second-next" }] }),
  );
  await page.getByRole("button", { name: "Refresh Git status" }).click();
  await expect(first).toHaveAttribute("title", "Staged");
  await expect(second).toHaveAttribute("title", "Modified");
});

test("a delayed project refresh does not change a newer project selection", async ({
  page,
}) => {
  const secondRoot = "/tmp/draw-local-playwright/second-project";
  await mkdir(secondRoot, { recursive: true });
  await page.goto("/");
  const registered = await page.request.post("/api/projects", {
    data: { path: secondRoot, name: "Second" },
  });
  expect(registered.ok()).toBeTruthy();
  const second = await registered.json();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted!: () => void;
  const reached = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route("**/api/project/git", async (route) => {
    const body = route.request().postDataJSON();
    if (body.projectId === "default") {
      intercepted();
      await pending;
    }
    await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reached;
  const secondButton = page.locator(
    `button[data-project-id="${second.id}"][data-project-path=""]`,
  );
  await secondButton.click();
  release();
  await expect(secondButton).toHaveClass(/active/);
  await expect(page.getByText("Not a Git repository")).toBeVisible();
});

test("draft rename supports typing and Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const draft = page.getByRole("button", {
    name: "Untitled draft",
    exact: true,
  });
  await draft.focus();
  await page.keyboard.press("F2");
  const name = page.getByRole("textbox", { name: "Draft name" });
  await name.pressSequentially("A longer draft name");
  await page.keyboard.press("Escape");
  await expect(draft).toBeFocused();
  await expect(draft).toHaveText("Untitled draft");
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
  await page
    .getByRole("button", { name: "Untitled draft", exact: true })
    .click();
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

test("drawing row actions support rename, Delete, bypass, and restore", async ({
  page,
}) => {
  const created = await page.request.post(
    "/api/project/file?projectId=default&path=light.excalidraw",
    {
      data: { document: { ...drawing, appState: { theme: "light" } } },
    },
  );
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .locator('button[data-project-id="default"][data-project-path=""]')
    .click();
  const row = page
    .locator(".drawing-row")
    .filter({ hasText: "light.excalidraw" });
  await expect(row.locator('.theme-badge[title="Light theme"]')).toBeVisible();
  await row.locator("button.file").click();
  await expect(page.getByRole("button", { name: "Save As" })).toBeEnabled();
  await row.getByRole("button", { name: "Rename light.excalidraw" }).click();
  const rename = page.getByRole("dialog", { name: "Rename drawing" });
  await rename
    .getByRole("textbox", { name: "Project-relative filename" })
    .fill("renamed.excalidraw");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(rename).toHaveCount(0);
  const renamed = page
    .locator(".drawing-row")
    .filter({ hasText: "renamed.excalidraw" });
  await expect(renamed).toBeVisible();
  await renamed.locator("button.file").focus();
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", { name: "Move drawing to Trash?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await renamed.locator("button.file").focus();
  await page.keyboard.press("Shift+Delete");
  await expect(confirm).toHaveCount(0);
  await expect(renamed).toHaveCount(0);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = page.getByRole("dialog", { name: "Trash" });
  await expect(trash).toContainText("renamed.excalidraw");
  await trash
    .getByRole("button", { name: "Restore renamed.excalidraw" })
    .click();
  await expect(renamed).toBeVisible();
});

test("Delete keeps an externally changed drawing and explains the conflict", async ({
  page,
}) => {
  const target = path.join(testRoot, "external.excalidraw");
  const created = await page.request.post(
    "/api/project/file?projectId=default&path=external.excalidraw",
    {
      data: { document: drawing },
    },
  );
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .locator('button[data-project-id="default"][data-project-path=""]')
    .click();
  const row = page
    .locator(".drawing-row")
    .filter({ hasText: "external.excalidraw" });
  await row.locator("button.file").click();
  await writeFile(
    target,
    JSON.stringify({ ...drawing, appState: { external: true } }),
  );
  await row.getByRole("button", { name: "Delete external.excalidraw" }).click();
  const dialog = page.getByRole("dialog", { name: "Move drawing to Trash?" });
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/changed|conflict/i);
  expect(
    (JSON.parse(await readFile(target, "utf8")) as typeof drawing).appState,
  ).toEqual({ external: true });
});

test("Trash restores to another registered project after the original is removed", async ({
  page,
}) => {
  const secondRoot = "/tmp/draw-local-playwright/second-project";
  await mkdir(secondRoot, { recursive: true });
  const registered = await page.request.post("/api/projects", {
    data: { path: secondRoot, name: "Second" },
  });
  const second = await registered.json();
  const created = await page.request.post(
    "/api/project/file?projectId=default&path=relocate.excalidraw",
    { data: { document: drawing } },
  );
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .locator('button[data-project-id="default"][data-project-path=""]')
    .click();
  const row = page
    .locator(".drawing-row")
    .filter({ hasText: "relocate.excalidraw" });
  await row.getByRole("button", { name: "Delete relocate.excalidraw" }).click();
  await page
    .getByRole("dialog", { name: "Move drawing to Trash?" })
    .getByRole("button", { name: "Move to Trash" })
    .click();
  await expect(row).toHaveCount(0);
  const root = page.locator(".project-root").filter({
    has: page.locator(
      'button[data-project-id="default"][data-project-path=""]',
    ),
  });
  await root.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Remove project from workspace?" })
    .getByRole("button", { name: "Remove from workspace" })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: "Restore elsewhere" }).click();
  const restore = page.getByRole("dialog", {
    name: "Restore drawing elsewhere",
  });
  await restore
    .getByRole("combobox", { name: "Project" })
    .selectOption(second.id);
  await restore
    .getByRole("textbox", { name: "Project-relative filename" })
    .fill("relocated.excalidraw");
  await restore.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(restore).toHaveCount(0);
  expect(
    (await savedElements(page, second.id, "relocated.excalidraw")).length,
  ).toBe(0);
});

test("macOS deletion shortcut is limited to a focused drawing row", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const deletedId = new URL(page.url()).searchParams.get("draft")!;
  const draft = page.getByRole("button", {
    name: "Untitled draft",
    exact: true,
  });
  await draft.focus();
  await page.keyboard.press("Meta+Alt+Backspace");
  await expect(
    page.getByRole("dialog", { name: "Move drawing to Trash?" }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      (await page.request.get(`/api/draft/${deletedId}`)).status(),
    )
    .toBe(400);
  await expect
    .poll(
      async () => (await (await page.request.get("/api/trash")).json()).length,
    )
    .toBe(1);
});

test("folder picker click expands a directory and project removal uses a modal", async ({
  page,
}) => {
  await mkdir(path.join(testRoot, "child-folder"), { recursive: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Browse folders" }).click();
  const picker = page.getByRole("dialog", { name: "Choose project folder" });
  await expect(picker.locator(".selected-path")).toHaveCount(0);
  await picker.locator(`[data-picker-path="${testRoot}"]`).click();
  await expect(
    picker.locator(`[data-picker-path="${testRoot}/child-folder"]`),
  ).toBeVisible();
  await picker.getByRole("button", { name: "Cancel" }).click();
  await page
    .locator(".project-root")
    .first()
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  const remove = page.getByRole("dialog", {
    name: "Remove project from workspace?",
  });
  await expect(remove).toContainText("stay on disk");
  await remove.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".project-root")).toHaveCount(1);
  await writeFile(
    path.join(testRoot, "keep.excalidraw"),
    JSON.stringify(drawing),
  );
  await page
    .locator(".project-root")
    .first()
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await remove.getByRole("button", { name: "Remove from workspace" }).click();
  await expect(page.locator(".project-root")).toHaveCount(0);
  expect(
    (await readFile(path.join(testRoot, "keep.excalidraw"), "utf8")).length,
  ).toBeGreaterThan(0);
});

test("nested Git root accepts a drawing drop and can become the project root", async ({
  page,
}) => {
  const nested = path.join(testRoot, "nested-repo");
  await mkdir(nested, { recursive: true });
  await git("git", ["init", nested]);
  const created = await page.request.post(
    "/api/project/file?projectId=default&path=move-me.excalidraw",
    {
      data: { document: drawing },
    },
  );
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .locator('button[data-project-id="default"][data-project-path=""]')
    .click();
  const folder = page
    .locator(".directory-row.git-root")
    .filter({ hasText: "nested-repo" });
  await expect(folder).toContainText("Git");
  await projectFile(page, "default", "move-me.excalidraw").dragTo(
    folder.locator(".tree-button"),
  );
  await folder.locator(".tree-button").click();
  await expect(
    folder.locator("button.file").filter({ hasText: "move-me.excalidraw" }),
  ).toBeVisible();
  await folder
    .locator("button.file")
    .filter({ hasText: "move-me.excalidraw" })
    .click();
  await expect(page).toHaveURL(/file=nested-repo/);
  await folder.getByRole("button", { name: "Make root" }).click();
  const promote = page.getByRole("dialog", {
    name: "Make this the project root?",
  });
  await promote.getByRole("button", { name: "Make project root" }).click();
  await expect(promote).toHaveCount(0);
  await expect(page).toHaveURL(/draft=/);
  const projects = await page.request.get("/api/projects");
  expect((await projects.json())[0].path).toBe(nested);
});

test("a collapsed Git project root accepts a drawing drop", async ({
  page,
}) => {
  const secondRoot = "/tmp/draw-local-playwright/git-project";
  await mkdir(secondRoot, { recursive: true });
  await git("git", ["init", secondRoot]);
  const registered = await page.request.post("/api/projects", {
    data: { path: secondRoot, name: "Git project" },
  });
  const second = await registered.json();
  const created = await page.request.post(
    "/api/project/file?projectId=default&path=to-git.excalidraw",
    { data: { document: drawing } },
  );
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page
    .locator('button[data-project-id="default"][data-project-path=""]')
    .click();
  const destination = page.locator(".project-root").filter({
    has: page.locator(
      `button[data-project-id="${second.id}"][data-project-path=""]`,
    ),
  });
  await expect(destination.locator(".project-git-context")).toHaveText("Git");
  await projectFile(page, "default", "to-git.excalidraw").dragTo(
    destination.locator(".tree-button"),
  );
  await expect
    .poll(async () =>
      (
        await page.request.get(
          `/api/project/file?projectId=${second.id}&path=to-git.excalidraw`,
        )
      ).status(),
    )
    .toBe(200);
});
